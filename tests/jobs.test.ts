import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryKV, update, __setKVForTests, type KV } from "@/lib/store";
import { rateLimitShared, reserveBudget, settleBudget, budgetSnapshot } from "@/lib/guards";
import { cacheGetShared, claimJob, createJob, findInflight, hashInput, publicJob, runJob } from "@/lib/jobs";
import { resetUsage } from "@/lib/usage";
import type { Generate } from "@/lib/openai";
import { POST } from "@/app/api/verify/route";
import { GET } from "@/app/api/verify/[id]/route";

// A rota local dispara runJob sem gerador injetado; nos testes isso NUNCA pode chegar à rede/OpenAI.
vi.mock("@/lib/jobs", async (orig) => {
  const m = await orig<typeof import("@/lib/jobs")>();
  return { ...m, runJob: ((kv: KV, p: never, deps: { generate?: Generate } = {}) => (deps.generate ? m.runJob(kv, p, deps) : Promise.resolve({ ran: false as const }))) as typeof m.runJob };
});

const ok = (tokens = 1000, searches = 1) => ({
  status: "completed",
  output: [
    ...Array.from({ length: searches }, () => ({ type: "web_search_call", action: { type: "search", queries: ["q"], sources: [{ url: "https://gov.br/doc" }] } })),
    {
      type: "message",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            resumo: "ok",
            classificacao: "Verdadeira",
            quem_criou: "a",
            qual_a_fonte: "b",
            qual_o_interesse: "c",
            evidencias: [{ fonte: "gov.br", papel: "primaria", posicao: "apoia", origem_comum: "DO" }],
          }),
          annotations: [{ type: "url_citation", url: "https://gov.br/doc", title: "gov.br" }],
        },
      ],
    },
  ],
  usage: { input_tokens: tokens - 100, output_tokens: 100, total_tokens: tokens },
});
const review = {
  status: "completed",
  output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ classificacao_revisada: "Verdadeira", objecoes: [] }), annotations: [] }] }],
  usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
};

let kv: KV;
beforeEach(() => {
  kv = memoryKV();
  __setKVForTests(kv);
  resetUsage();
  process.env.DAILY_COST_BUDGET_USD = "5";
  delete process.env.RATE_LIMIT_PER_MINUTE;
});

describe("armazenamento compartilhado (CAS)", () => {
  it("updates concorrentes não perdem contagem", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        update(
          kv,
          "c",
          () => ({ n: 0 }),
          (c) => ({ n: c.n + 1 }),
        ),
      ),
    );
    expect((await kv.get<{ n: number }>("c"))!.value.n).toBe(20);
  });
});

describe("limite persistente por IP e orçamento", () => {
  it("bloqueia o 5º pedido no mesmo minuto e separa IPs", async () => {
    const r = [];
    for (let i = 0; i < 5; i++) r.push((await rateLimitShared(kv, "1.2.3.4", 1000 + i)).ok);
    expect(r).toEqual([true, true, true, true, false]);
    expect((await rateLimitShared(kv, "9.9.9.9", 1000)).ok).toBe(true);
  });
  it("reserva e libera orçamento; recusa acima do teto diário", async () => {
    process.env.DAILY_COST_BUDGET_USD = "0.25";
    const t = 1_700_000_000_000;
    expect((await reserveBudget(kv, 0.1, t)).ok).toBe(true);
    expect((await reserveBudget(kv, 0.1, t)).ok).toBe(true);
    expect((await reserveBudget(kv, 0.1, t)).ok).toBe(false);
    await settleBudget(kv, 0.1, { costUsd: 0.02, tokens: 10, searches: 1, calls: 2 }, t);
    expect((await reserveBudget(kv, 0.1, t)).ok).toBe(true);
    expect((await budgetSnapshot(kv, t)).spentUsd).toBeCloseTo(0.02, 5);
  });
  it("concorrência não estoura o orçamento", async () => {
    process.env.DAILY_COST_BUDGET_USD = "0.35";
    const res = await Promise.all(Array.from({ length: 10 }, () => reserveBudget(kv, 0.1, 5)));
    expect(res.filter((r) => r.ok)).toHaveLength(3);
  });
});

describe("jobs em segundo plano", () => {
  it("executa uma única vez por job, mesmo com chamadas duplicadas", async () => {
    const hash = hashInput("alegação X");
    const job = await createJob(kv, hash, 0.1);
    const gen = vi.fn<Generate>().mockResolvedValueOnce(ok()).mockResolvedValueOnce(review);
    const args = { id: job.id, nonce: job.nonce, input: "alegação X", url: null };
    const [a, b] = await Promise.all([runJob(kv, args, { generate: gen }), runJob(kv, args, { generate: gen })]);
    expect([a.ran, b.ran].sort()).toEqual([false, true]);
    expect(gen).toHaveBeenCalledTimes(2); // investigação + revisão, uma vez só
    const view = await publicJob(kv, job.id);
    expect(view?.status).toBe("done");
    expect(view?.result?.classificacao).toBe("Verdadeira");
    expect(JSON.stringify(view)).not.toContain(job.nonce);
    expect((await cacheGetShared(kv, hash))?.uso.cache).toBe(true);
  });
  it("rejeita nonce errado e entrada divergente", async () => {
    const job = await createJob(kv, hashInput("a"), 0.1);
    const gen = vi.fn<Generate>();
    expect((await runJob(kv, { id: job.id, nonce: "errado", input: "a", url: null }, { generate: gen })).ran).toBe(false);
    expect((await runJob(kv, { id: job.id, nonce: job.nonce, input: "outra coisa", url: null }, { generate: gen })).ran).toBe(true);
    expect(gen).not.toHaveBeenCalled();
    expect((await publicJob(kv, job.id))?.status).toBe("failed");
  });
  it("falha após gasto pago registra o custo real e libera a reserva", async () => {
    const t = Date.now();
    await reserveBudget(kv, 0.1, t);
    const job = await createJob(kv, hashInput("sem busca"), 0.1);
    const gen = vi.fn<Generate>().mockResolvedValueOnce(ok(2000, 0)); // sem busca => no_search, mas os tokens foram pagos
    await runJob(kv, { id: job.id, nonce: job.nonce, input: "sem busca", url: null }, { generate: gen });
    const view = await publicJob(kv, job.id);
    expect(view?.status).toBe("failed");
    expect(view?.error?.code).toBe("no_search");
    const snap = await budgetSnapshot(kv, t);
    expect(snap.spentUsd).toBeGreaterThan(0);
    expect(snap.reservedUsd).toBe(0);
  });
  it("reaproveita job em andamento em vez de pagar de novo", async () => {
    const h = hashInput("repetida");
    const job = await createJob(kv, h, 0.1);
    expect(await findInflight(kv, h)).toBe(job.id);
    await claimJob(kv, job.id, job.nonce);
    expect(await findInflight(kv, h)).toBe(job.id);
  });
  it("job inexistente ou id malformado => null", async () => {
    expect(await publicJob(kv, "nope")).toBeNull();
    expect(await publicJob(kv, "0".repeat(32))).toBeNull();
  });
});

describe("rotas", () => {
  const post = (input: string) => POST(new Request("http://t/api/verify", { method: "POST", body: JSON.stringify({ input }) }));
  it("cria job (202) e permite consultar o andamento", async () => {
    process.env.OPENAI_API_KEY = "sk-test-nao-usada";
    const r = await post("Alegação de teste para fila");
    expect(r.status).toBe(202);
    const { jobId } = await r.json();
    const g = await GET(new Request("http://t/api/verify/" + jobId), { params: Promise.resolve({ id: jobId }) });
    expect(g.status).toBe(200);
    delete process.env.OPENAI_API_KEY;
  });
  it("404 para job desconhecido", async () => {
    const g = await GET(new Request("http://t/x"), { params: Promise.resolve({ id: "f".repeat(32) }) });
    expect(g.status).toBe(404);
  });
  it("recusa quando o orçamento diário acabou", async () => {
    process.env.OPENAI_API_KEY = "sk-test-nao-usada";
    process.env.DAILY_COST_BUDGET_USD = "0.05";
    const r = await post("Outra alegação para testar orçamento");
    expect(r.status).toBe(429);
    expect((await r.json()).code).toBe("budget");
    delete process.env.OPENAI_API_KEY;
  });
});
