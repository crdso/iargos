import { createHash, randomBytes } from "node:crypto";
import { settleBudget } from "./guards";
import { maxCostPerVerification, runVerification, VerifyError, type Generate } from "./openai";
import type { VerifyResult } from "./schema";
import { update, type KV } from "./store";

export type Job = {
  id: string;
  nonce: string; // segredo conhecido só pela rota e pela função em segundo plano
  hash: string; // hash da entrada; o texto em si nunca é persistido
  status: "queued" | "running" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
  reserveUsd: number;
  result?: VerifyResult;
  error?: { message: string; code: string; status: number };
};

export const hashInput = (input: string) => createHash("sha256").update(input.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
const CACHE_TTL = 30 * 60_000;
const STALE_JOB = 6 * 60_000;

export async function cacheGetShared(kv: KV, hash: string, now = Date.now()): Promise<VerifyResult | null> {
  const c = await kv.get<{ at: number; result: VerifyResult }>(`cache:${hash}`);
  if (!c || now - c.value.at > CACHE_TTL) return null;
  return { ...c.value.result, uso: { ...c.value.result.uso, cache: true } };
}

/** Evita pagar duas vezes pela mesma verificação em andamento (entre instâncias). */
export async function findInflight(kv: KV, hash: string, now = Date.now()): Promise<string | null> {
  const ref = await kv.get<{ id: string }>(`inflight:${hash}`);
  if (!ref) return null;
  const job = await kv.get<Job>(`job:${ref.value.id}`);
  if (job && (job.value.status === "queued" || job.value.status === "running") && now - job.value.updatedAt < STALE_JOB) return job.value.id;
  return null;
}

export async function createJob(kv: KV, hash: string, reserveUsd: number, now = Date.now()): Promise<Job> {
  const job: Job = { id: randomBytes(16).toString("hex"), nonce: randomBytes(24).toString("hex"), hash, status: "queued", createdAt: now, updatedAt: now, reserveUsd };
  await kv.put(`job:${job.id}`, job, { ifNew: true });
  await kv.put(`inflight:${hash}`, { id: job.id });
  return job;
}

export async function publicJob(kv: KV, id: string) {
  if (!/^[0-9a-f]{32}$/.test(id)) return null;
  const j = (await kv.get<Job>(`job:${id}`))?.value;
  if (!j) return null;
  const stale = (j.status === "queued" || j.status === "running") && Date.now() - j.updatedAt > STALE_JOB;
  return {
    id: j.id,
    status: stale ? ("failed" as const) : j.status,
    result: j.result,
    error: stale ? { message: "A análise não terminou a tempo. Tente novamente.", code: "stale", status: 504 } : j.error,
  };
}

/** Marca queued→running de forma atômica: uma segunda chamada com o mesmo job não repete o gasto. */
export async function claimJob(kv: KV, id: string, nonce: string): Promise<Job | null> {
  let claimed: Job | null = null;
  await update<Job | null>(
    kv,
    `job:${id}`,
    () => null,
    (j) => {
      claimed = null; // a função pode rodar várias vezes (retentativas de CAS): só vale a última
      if (!j || j.nonce !== nonce || j.status !== "queued") return { abort: true };
      j.status = "running";
      j.updatedAt = Date.now();
      claimed = j;
      return j;
    },
  );
  return claimed;
}

async function finish(kv: KV, id: string, patch: Partial<Job>) {
  await update<Job | null>(
    kv,
    `job:${id}`,
    () => null,
    (j) => (j ? { ...j, ...patch, updatedAt: Date.now() } : { abort: true }),
  );
}

/** Executa a verificação de um job já reservado. Compartilhado pela função em segundo plano e pelo modo local. */
export async function runJob(kv: KV, p: { id: string; nonce: string; input: string; url: string | null }, deps: { generate?: Generate } = {}) {
  const job = await claimJob(kv, p.id, p.nonce);
  if (!job) return { ran: false as const };
  if (hashInput(p.input) !== job.hash) {
    await finish(kv, p.id, { status: "failed", error: { message: "Requisição inconsistente.", code: "mismatch", status: 400 } });
    await settleBudget(kv, job.reserveUsd, { costUsd: 0, tokens: 0, searches: 0, calls: 0 });
    return { ran: true as const };
  }
  try {
    const result = await runVerification(p.input, p.url, deps);
    await settleBudget(kv, job.reserveUsd, { costUsd: result.uso.custoUsd, tokens: result.uso.tokensTotal, searches: result.uso.consultasBusca, calls: result.uso.chamadas });
    await kv.put(`cache:${job.hash}`, { at: Date.now(), result });
    await finish(kv, p.id, { status: "done", result });
  } catch (e) {
    const ve = e instanceof VerifyError ? e : null;
    await settleBudget(kv, job.reserveUsd, { costUsd: ve?.spentUsd ?? 0, tokens: ve?.spentTokens ?? 0, searches: ve?.spentSearches ?? 0, calls: ve?.spentCalls ?? 0 });
    await finish(kv, p.id, { status: "failed", error: { message: ve?.message ?? "Erro interno.", code: ve?.code ?? "internal", status: ve?.status ?? 500 } });
  }
  return { ran: true as const };
}

export const reserveAmount = () => maxCostPerVerification();
