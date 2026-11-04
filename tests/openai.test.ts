import { describe, expect, it, vi } from "vitest";
import { cleanUrl, estimateCost, normalizeResponse } from "@/lib/usage";
import { mapOpenAIError, planSearchBudget } from "@/lib/openai";

// Formato real da Responses API com web_search (resumido).
const real = {
  id: "resp_1",
  status: "completed",
  output: [
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "pix banco central 2020", queries: ["pix banco central 2020", "pix lançamento"], sources: [{ type: "url", url: "https://www.bcb.gov.br/pix?utm_source=openai" }] } },
    { type: "web_search_call", id: "ws_2", status: "completed", action: { type: "open_page", url: "https://www.bcb.gov.br/pix" } },
    { type: "web_search_call", id: "ws_3", status: "completed", action: { type: "search", query: "pix lançamento", sources: [{ type: "url", url: "https://g1.globo.com/pix" }] } },
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      content: [
        {
          type: "output_text",
          text: '{"resumo":"x"}',
          annotations: [
            { type: "url_citation", url: "https://www.bcb.gov.br/pix?utm_source=openai", title: "Pix - Banco Central", start_index: 0, end_index: 5 },
            { type: "file_citation", file_id: "f" },
          ],
        },
      ],
    },
  ],
  usage: { input_tokens: 12000, input_tokens_details: { cached_tokens: 2000 }, output_tokens: 1500, output_tokens_details: { reasoning_tokens: 400 }, total_tokens: 13500 },
};

describe("normalizeResponse (Responses API real)", () => {
  const n = normalizeResponse(real);
  it("conta só ações 'search' como chamadas de busca", () => {
    expect(n.searchCalls).toBe(2); // open_page não é busca cobrada
  });
  it("extrai consultas (queries e query legado)", () => {
    expect(n.queries).toEqual(["pix banco central 2020", "pix lançamento", "pix lançamento"]);
  });
  it("extrai fontes consultadas e citações url_citation, limpando utm_source", () => {
    expect(n.consulted.map((c) => c.url)).toEqual(["https://www.bcb.gov.br/pix", "https://g1.globo.com/pix"]);
    expect(n.citations).toEqual([{ url: "https://www.bcb.gov.br/pix", title: "Pix - Banco Central" }]);
  });
  it("extrai texto e tokens", () => {
    expect(n.text).toBe('{"resumo":"x"}');
    expect(n).toMatchObject({ entrada: 12000, saida: 1500, total: 13500, cached: 2000 });
  });
  it("tolera respostas vazias ou malformadas", () => {
    expect(normalizeResponse({})).toMatchObject({ searchCalls: 0, text: "", total: 0 });
    expect(normalizeResponse(null).citations).toEqual([]);
    expect(normalizeResponse({ output_text: "olá" }).text).toBe("olá");
  });
});

describe("custo", () => {
  it("usa a tabela do gpt-5.4-mini + US$ 0,01 por busca", () => {
    const c = estimateCost(normalizeResponse(real), "gpt-5.4-mini");
    // (10000*0,75 + 2000*0,075 + 1500*4,5)/1e6 = 0,014400 ; buscas 2 × 0,01
    expect(c.tokens).toBeCloseTo(0.0144, 6);
    expect(c.search).toBeCloseTo(0.02, 6);
    expect(c.total).toBeCloseTo(0.0344, 6);
  });
  it("limita o número de buscas pelo teto de gasto por verificação", () => {
    expect(planSearchBudget(false, 0.1)).toBe(2);
    expect(planSearchBudget(true, 0.1)).toBe(4);
    expect(planSearchBudget(true, 0.05)).toBe(2);
    expect(planSearchBudget(true, 0.01)).toBe(1); // sempre ao menos 1
  });
});

describe("cleanUrl", () => {
  it("remove só utm_source", () => {
    expect(cleanUrl("https://a.com/x?id=1&utm_source=openai")).toBe("https://a.com/x?id=1");
    expect(cleanUrl("não é url")).toBe("não é url");
  });
});

describe("erros da OpenAI", () => {
  const err = (status: number, msg = "x") => Object.assign(new Error(msg), { status });
  vi.spyOn(console, "error").mockImplementation(() => {});
  it.each([
    [401, 503, "bad_key"],
    [403, 503, "forbidden"],
    [404, 503, "bad_model"],
    [429, 429, "quota"],
    [400, 502, "bad_request"],
    [500, 502, "upstream"],
    [503, 502, "upstream"],
  ])("HTTP %i => %i %s", (st, http, code) => {
    const e = mapOpenAIError(err(st), "gpt-5.4-mini");
    expect(e.status).toBe(http);
    expect(e.code).toBe(code);
  });
  it("timeout", () => {
    expect(mapOpenAIError(new Error("Request timed out."), "m").code).toBe("timeout");
  });
  it("nunca vaza a chave nos detalhes", () => {
    const e = mapOpenAIError(err(401, "Incorrect API key provided: sk-proj-abcdefghijklmnop1234 Bearer sk-xyz12345678"), "m");
    expect(e.detail).not.toMatch(/sk-proj|sk-xyz/);
  });
});

import { cleanText, limitSources } from "@/lib/analysis";
describe("limpeza de texto e fontes", () => {
  it("remove citações em markdown e utm_source", () => {
    expect(cleanText("O Pix foi lançado em 2020. ([gov.br](https://gov.br/x?utm_source=openai))")).toBe("O Pix foi lançado em 2020.");
    expect(cleanText("Veja [BC](https://bcb.gov.br/p?utm_source=openai) agora")).toBe("Veja BC agora");
  });
  it("limita fontes exibidas priorizando citadas e usadas na matriz", () => {
    const f = Array.from({ length: 40 }, (_, i) => ({ titulo: `s${i}`, dominio: "d", url: `https://d.com/${i}`, relevancia: "", citada: i === 30 }));
    const out = limitSources(f, new Set(["https://d.com/35"]), 15);
    expect(out).toHaveLength(15);
    expect(out[0].url).toBe("https://d.com/30");
    expect(out[1].url).toBe("https://d.com/35");
  });
});
