import { beforeEach, describe, expect, it, vi } from "vitest";
import { runVerification, type Generate } from "@/lib/openai";
import { resetUsage, usageSnapshot, recordUsage } from "@/lib/usage";
import { applyValidators } from "@/lib/verification";

type Ev = { fonte: string; papel: "primaria" | "independente" | "republicacao"; posicao: "apoia" | "contradiz" | "neutra"; origem_comum?: string; data_fato?: string };

const SITES: Record<string, string> = {
  "gov.br": "https://gov.br/doc",
  "ibge.gov.br": "https://ibge.gov.br/dados",
  "folha.com.br": "https://folha.com.br/n",
  "g1.globo.com": "https://g1.globo.com/n",
  "uol.com.br": "https://uol.com.br/n",
  "blogA.com": "https://blogA.com/n",
  "blogB.com": "https://blogB.com/n",
  "blogC.com": "https://blogC.com/n",
  "blogD.com": "https://blogD.com/n",
  "aosfatos.org": "https://aosfatos.org/c",
  "lupa.news": "https://lupa.news/c",
};

function model(classificacao: string, evidencias: Ev[], extra: Record<string, unknown> = {}) {
  return {
    resumo: "Resumo do modelo.",
    classificacao,
    alegacao_principal: "Alegação X",
    quem_criou: "Autor",
    qual_a_fonte: "Fonte",
    qual_o_interesse: "Não foi possível determinar interesses específicos.",
    limitacoes: "",
    evidencias,
    ...extra,
  };
}

/** Resposta no formato real da OpenAI Responses API (web_search_call + message/output_text/url_citation). */
function resp(json: unknown, sites: string[], tokens = 1000, searches = 3) {
  const text = JSON.stringify(json);
  return {
    id: "resp_test",
    status: "completed",
    output: [
      ...Array.from({ length: searches }, (_, i) => ({
        type: "web_search_call",
        id: `ws_${i}`,
        status: "completed",
        action: { type: "search", queries: [`consulta ${i}`], sources: sites.map((s) => ({ type: "url", url: SITES[s] + "?utm_source=openai" })) },
      })),
      { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: sites.map((s) => ({ type: "url_citation", url: SITES[s] + "?utm_source=openai", title: s, start_index: 0, end_index: 1 })) }] },
    ],
    usage: { input_tokens: tokens - 200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 200, output_tokens_details: { reasoning_tokens: 50 }, total_tokens: tokens },
  };
}

const review = (c: string) => ({
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ classificacao_revisada: c, objecoes: ["revisão"] }), annotations: [] }] }],
  usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
});

function gen(first: unknown, second: unknown = review("Verdadeira")) {
  return vi.fn<Generate>().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
}

let n = 0;
const input = (t: string) => `${t} #${++n}`; // evita cache entre testes

beforeEach(() => resetUsage());

describe("notícias verdadeiras", () => {
  it("mantém Verdadeira com documento primário + fontes independentes", async () => {
    const g = gen(
      resp(
        model("Verdadeira", [
          { fonte: "ibge.gov.br", papel: "primaria", posicao: "apoia", origem_comum: "IBGE" },
          { fonte: "folha.com.br", papel: "independente", posicao: "apoia", origem_comum: "apuração Folha" },
          { fonte: "g1.globo.com", papel: "independente", posicao: "apoia", origem_comum: "apuração G1" },
        ]),
        ["ibge.gov.br", "folha.com.br", "g1.globo.com"],
      ),
    );
    const r = await runVerification(input("PIB cresceu"), null, { generate: g });
    expect(r.classificacao).toBe("Verdadeira");
    expect(r.linhasIndependentes).toMatchObject({ apoio: 3, primariaApoio: true });
    expect(r.confianca).toBeGreaterThan(60);
    expect(r.fontes.length).toBe(3);
    expect(g).toHaveBeenCalledTimes(2); // investigação + revisão
  });

  it("um único documento primário decisivo basta", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "gov.br", papel: "primaria", posicao: "apoia", origem_comum: "Diário Oficial" }]), ["gov.br"]));
    expect((await runVerification(input("Lei sancionada"), null, { generate: g })).classificacao).toBe("Verdadeira");
  });
});

describe("notícias falsas", () => {
  it("mantém Falsa quando há desmentido primário", async () => {
    const g = gen(
      resp(model("Falsa", [{ fonte: "gov.br", papel: "primaria", posicao: "contradiz", origem_comum: "nota oficial" }, { fonte: "aosfatos.org", papel: "independente", posicao: "contradiz", origem_comum: "checagem" }]), ["gov.br", "aosfatos.org"]),
      review("Falsa"),
    );
    const r = await runVerification(input("Vacina tem chip"), null, { generate: g });
    expect(r.classificacao).toBe("Falsa");
    expect(r.linhasIndependentes.primariaContradicao).toBe(true);
  });

  it("não aceita 'Falsa' só por falta de publicações", async () => {
    const g = gen(resp(model("Falsa", []), ["folha.com.br"]));
    const r = await runVerification(input("Evento inexistente"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(g).toHaveBeenCalledTimes(1);
  });
});

describe("boatos copiados por vários sites", () => {
  it("quatro republicações da mesma origem não confirmam: Inconclusiva", async () => {
    const ev: Ev[] = ["blogA.com", "blogB.com", "blogC.com", "blogD.com"].map((f) => ({ fonte: f, papel: "republicacao", posicao: "apoia", origem_comum: "post anônimo no WhatsApp" }));
    const g = gen(resp(model("Verdadeira", ev), ["blogA.com", "blogB.com", "blogC.com", "blogD.com"]));
    const r = await runVerification(input("Boato famoso"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(r.confianca).toBeNull();
    expect(r.validacoes.join(" ")).toMatch(/republica/i);
    expect(r.linhasIndependentes.apoio).toBe(0);
  });

  it("'independentes' que declaram a mesma origem contam como uma única linha", () => {
    const fontes = ["folha.com.br", "g1.globo.com", "uol.com.br"].map((d) => ({ titulo: d, dominio: d, url: SITES[d], relevancia: "" }));
    const v = applyValidators({
      parsed: {
        classificacao: "Verdadeira",
        fato_antigo_republicado: false,
        data_fato: "",
        evidencias: ["folha.com.br", "g1.globo.com", "uol.com.br"].map((f) => ({ fonte: f, alegacao_id: 1, papel: "independente" as const, posicao: "apoia" as const, origem_comum: "Agência Única", data_fato: "", data_publicacao: "", trecho: "" })),
      },
      fontes,
    });
    expect(v.linhas.apoio).toBe(1);
    expect(v.classificacao).toBe("Inconclusiva");
  });

  it("três linhas realmente independentes sem primária bastam", () => {
    const ds = ["folha.com.br", "g1.globo.com", "uol.com.br"];
    const v = applyValidators({
      parsed: {
        classificacao: "Majoritariamente verdadeira",
        fato_antigo_republicado: false,
        data_fato: "",
        evidencias: ds.map((f) => ({ fonte: f, alegacao_id: 1, papel: "independente" as const, posicao: "apoia" as const, origem_comum: `apuração ${f}`, data_fato: "", data_publicacao: "", trecho: "" })),
      },
      fontes: ds.map((d) => ({ titulo: d, dominio: d, url: SITES[d], relevancia: "" })),
    });
    expect(v.linhas.apoio).toBe(3);
    expect(v.classificacao).toBe("Majoritariamente verdadeira");
  });
});

describe("notícias antigas reapresentadas como recentes", () => {
  it("rebaixa Verdadeira para Enganosa", async () => {
    const g = gen(
      resp(
        model(
          "Verdadeira",
          [
            { fonte: "ibge.gov.br", papel: "primaria", posicao: "apoia", origem_comum: "IBGE", data_fato: "2019-03-10" },
          ],
          { fato_antigo_republicado: true, data_fato: "2019-03-10" },
        ),
        ["ibge.gov.br"],
      ),
    );
    const r = await runVerification(input("Notícia 'de hoje'"), null, { generate: g });
    expect(r.classificacao).toBe("Enganosa ou fora de contexto");
    expect(r.validacoes.join(" ")).toMatch(/antigo/);
  });
});

describe("fontes contraditórias", () => {
  it("apoio independente + contradição independente sem primária => Inconclusiva", async () => {
    const g = gen(
      resp(
        model("Verdadeira", [
          { fonte: "folha.com.br", papel: "independente", posicao: "apoia", origem_comum: "a" },
          { fonte: "g1.globo.com", papel: "independente", posicao: "apoia", origem_comum: "b" },
          { fonte: "uol.com.br", papel: "independente", posicao: "apoia", origem_comum: "c" },
          { fonte: "aosfatos.org", papel: "independente", posicao: "contradiz", origem_comum: "d" },
        ]),
        ["folha.com.br", "g1.globo.com", "uol.com.br", "aosfatos.org"],
      ),
    );
    const r = await runVerification(input("Alegação disputada"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(r.validacoes.join(" ")).toMatch(/contradit/);
  });

  it("primária de um lado resolve o conflito", () => {
    const ds = ["gov.br", "folha.com.br", "aosfatos.org"];
    const mk = (fonte: string, papel: "primaria" | "independente", posicao: "apoia" | "contradiz") => ({ fonte, alegacao_id: 1, papel, posicao, origem_comum: fonte, data_fato: "", data_publicacao: "", trecho: "" });
    const v = applyValidators({
      parsed: { classificacao: "Verdadeira", fato_antigo_republicado: false, data_fato: "", evidencias: [mk("gov.br", "primaria", "apoia"), mk("folha.com.br", "independente", "apoia"), mk("aosfatos.org", "independente", "contradiz")] },
      fontes: ds.map((d) => ({ titulo: d, dominio: d, url: SITES[d], relevancia: "" })),
    });
    expect(v.classificacao).toBe("Verdadeira");
  });
});

describe("integridade da matriz e revisão", () => {
  it("evidência de fonte que a busca não retornou não conta", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "fonte-inventada.com", papel: "primaria", posicao: "apoia", origem_comum: "x" }]), ["folha.com.br"]));
    const r = await runVerification(input("Fonte inventada"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(r.matriz[0].grounded).toBe(false);
    expect(r.matriz[0].url).toBeNull();
  });

  it("a página enviada pelo usuário não corrobora a si mesma", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "folha.com.br", papel: "primaria", posicao: "apoia", origem_comum: "x" }]), ["folha.com.br"]));
    const r = await runVerification("https://www.folha.com.br/noticia", "https://www.folha.com.br/noticia", { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
  });

  it("a revisão crítica pode rebaixar o veredito", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "gov.br", papel: "primaria", posicao: "apoia", origem_comum: "DO" }]), ["gov.br"]), review("Inconclusiva"));
    const r = await runVerification(input("Revisor discorda"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(r.confianca).toBeNull();
  });

  it("a revisão nunca aumenta a certeza", async () => {
    const g = gen(resp(model("Inconclusiva", []), ["folha.com.br"]), review("Verdadeira"));
    const r = await runVerification(input("Sem provas"), null, { generate: g });
    expect(r.classificacao).toBe("Inconclusiva");
    expect(g).toHaveBeenCalledTimes(1); // nem chama o revisor
  });

  it("recusa resposta sem busca real (apenas 'afirma' ter pesquisado)", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "gov.br", papel: "primaria", posicao: "apoia" }]), ["gov.br"], 1000, 0));
    await expect(runVerification(input("Só memória do modelo"), null, { generate: g })).rejects.toMatchObject({ code: "no_search" });
  });

  it("recusa resposta com busca mas sem nenhuma fonte", async () => {
    const g = gen(resp(model("Verdadeira", []), [], 1000, 2));
    await expect(runVerification(input("Busca vazia"), null, { generate: g })).rejects.toMatchObject({ code: "no_search" });
  });

  it("falha da revisão limita a confiança", async () => {
    const g = vi.fn<Generate>().mockResolvedValueOnce(resp(model("Verdadeira", [{ fonte: "gov.br", papel: "primaria", posicao: "apoia", origem_comum: "DO" }]), ["gov.br"])).mockRejectedValueOnce(new Error("x"));
    const r = await runVerification(input("Revisor falha"), null, { generate: g });
    expect(r.confianca).toBeLessThanOrEqual(60);
    expect(r.limitacoes).toMatch(/revisão crítica/);
  });
});

describe("consumo de tokens e buscas", () => {
  it("soma tokens/buscas e usa cache na repetição", async () => {
    const g = gen(resp(model("Verdadeira", [{ fonte: "gov.br", papel: "primaria", posicao: "apoia", origem_comum: "DO" }]), ["gov.br"], 1000, 4));
    const q = input("Consumo");
    const a = await runVerification(q, null, { generate: g });
    expect(a.uso).toMatchObject({ chamadas: 2, tokensTotal: 1300, consultasBusca: 4, revisaoExecutada: true, cache: false });
    // custo = tokens (800*0,75 + 200*4,5 + 200*0,75 + 100*4,5)/1M + 4 buscas × US$ 0,01
    expect(a.uso.custoUsd).toBeCloseTo(0.04 + (800 * 0.75 + 200 * 4.5 + 200 * 0.75 + 100 * 4.5) / 1e6, 4);
    expect(a.uso.consultasEfetuadas).toHaveLength(4);
    expect(a.fontes[0].url).toBe(SITES["gov.br"]); // utm_source removido
    const b = await runVerification(q, null, { generate: g });
    expect(b.uso.cache).toBe(true);
    expect(g).toHaveBeenCalledTimes(2);
    expect(usageSnapshot()).toMatchObject({ tokens: 1300, searches: 4, cacheHits: 1 });
    expect(usageSnapshot().cost).toBeGreaterThan(0.04);
  });

  it("bloqueia ao esgotar o orçamento diário", async () => {
    process.env.DAILY_TOKEN_BUDGET = "500";
    recordUsage({ tokens: 600, searches: 0 });
    const g = vi.fn<Generate>();
    await expect(runVerification(input("Sem orçamento"), null, { generate: g })).rejects.toMatchObject({ code: "budget" });
    expect(g).not.toHaveBeenCalled();
    delete process.env.DAILY_TOKEN_BUDGET;
  });
});
