import { describe, expect, it, beforeEach } from "vitest";
import { computeConfidence, extractSources, parseModelJson } from "@/lib/analysis";
import { extractUrl, isSafeUrl, rateLimit, resetRateLimit } from "@/lib/security";
import { POST } from "@/app/api/verify/route";

const valid = {
  resumo: "ok",
  classificacao: "Falsa",
  quem_criou: "a",
  qual_a_fonte: "b",
  qual_o_interesse: "c",
  criterios: { qualidade_evidencias: 5, fontes_independentes: 5, consistencia: 5, atualidade: 5, documentos_primarios: 5 },
};

describe("parseModelJson", () => {
  it("aceita JSON em bloco de código", () => {
    expect(parseModelJson("```json\n" + JSON.stringify(valid) + "\n```")?.classificacao).toBe("Falsa");
  });
  it("rejeita lixo e classificação inválida", () => {
    expect(parseModelJson("não é json")).toBeNull();
    expect(parseModelJson(JSON.stringify({ ...valid, classificacao: "Talvez" }))).toBeNull();
  });
});

describe("computeConfidence", () => {
  it("calcula por critérios", () => {
    expect(computeConfidence(valid.criterios, 3)).toBe(100);
  });
  it("não determina sem fontes ou sem critérios essenciais", () => {
    expect(computeConfidence(valid.criterios, 0)).toBeNull();
    expect(computeConfidence({ ...valid.criterios, consistencia: null }, 3)).toBeNull();
    expect(computeConfidence(null, 3)).toBeNull();
  });
  it("limita a 50 com uma única fonte", () => {
    expect(computeConfidence(valid.criterios, 1)).toBe(50);
  });
});

describe("extractSources", () => {
  it("usa só links reais e ignora esquemas perigosos", () => {
    const s = extractSources(
      { groundingChunks: [{ web: { uri: "https://g1.globo.com/x", title: "g1.globo.com" } }, { web: { uri: "javascript:alert(1)", title: "x" } }, {}] },
      undefined,
      [{ titulo: "g1.globo.com", relevancia: "Fonte primária" }],
    );
    expect(s).toHaveLength(1);
    expect(s[0].relevancia).toBe("Fonte primária");
  });
  it("sem metadados, sem fontes", () => {
    expect(extractSources(undefined, undefined, [])).toEqual([]);
  });
});

describe("segurança", () => {
  it("valida URLs", () => {
    expect(extractUrl("https://a.com/x")).toBe("https://a.com/x");
    expect(extractUrl("uma frase qualquer")).toBeNull();
    expect(isSafeUrl("http://localhost:3000")).toBe(false);
    expect(isSafeUrl("http://192.168.0.1")).toBe(false);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("https://g1.globo.com/a")).toBe(true);
  });
  it("aplica rate limit", () => {
    resetRateLimit();
    const l = { perMinute: 2, perDay: 10, global: 100 };
    expect(rateLimit("x", 0, l).ok).toBe(true);
    expect(rateLimit("x", 1, l).ok).toBe(true);
    expect(rateLimit("x", 2, l).ok).toBe(false);
    expect(rateLimit("x", 61_000, l).ok).toBe(true);
  });
});

describe("POST /api/verify", () => {
  beforeEach(() => {
    resetRateLimit();
    delete process.env.GEMINI_API_KEY;
  });
  const call = (body: unknown) => POST(new Request("http://t/api/verify", { method: "POST", body: JSON.stringify(body) }));
  it("400 para entrada curta", async () => {
    expect((await call({ input: "oi" })).status).toBe(400);
  });
  it("400 para URL local", async () => {
    expect((await call({ input: "http://localhost:8080/x" })).status).toBe(400);
  });
  it("503 'API não configurada' sem chave", async () => {
    const r = await call({ input: "A Terra é plana segundo estudo" });
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("not_configured");
  });
});
