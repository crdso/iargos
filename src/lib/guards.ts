import { createHash } from "node:crypto";
import { update, type KV } from "./store";

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
export const limits = () => ({
  perMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 4),
  perDay: num(process.env.RATE_LIMIT_PER_DAY, 40),
  globalRequests: num(process.env.GLOBAL_DAILY_LIMIT, 300),
  dailyCostUsd: num(process.env.DAILY_COST_BUDGET_USD, 5),
});

export const hashIp = (ip: string) => createHash("sha256").update("iargos:" + ip).digest("hex").slice(0, 24);
const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);

/** Limite por IP (hash), compartilhado entre instâncias. */
export async function rateLimitShared(kv: KV, ip: string, now = Date.now()): Promise<{ ok: boolean; retryAfter?: number; reason?: string }> {
  const L = limits();
  const key = `rl:${hashIp(ip)}`;
  let verdict: { ok: boolean; retryAfter?: number; reason?: string } = { ok: true };
  await update<{ m: number[]; d: number[] }>(
    kv,
    key,
    () => ({ m: [], d: [] }),
    (cur) => {
      cur.m = cur.m.filter((t) => now - t < 60_000);
      cur.d = cur.d.filter((t) => now - t < 86_400_000);
      if (cur.m.length >= L.perMinute) {
        verdict = { ok: false, retryAfter: Math.ceil((60_000 - (now - cur.m[0])) / 1000), reason: "Muitas verificações em pouco tempo. Aguarde um instante." };
        return { abort: true };
      }
      if (cur.d.length >= L.perDay) {
        verdict = { ok: false, retryAfter: 3600, reason: "Limite diário de verificações atingido." };
        return { abort: true };
      }
      cur.m.push(now);
      cur.d.push(now);
      return cur;
    },
  );
  return verdict;
}

export type Budget = { requests: number; reservedUsd: number; spentUsd: number; tokens: number; searches: number; calls: number };
const emptyBudget = (): Budget => ({ requests: 0, reservedUsd: 0, spentUsd: 0, tokens: 0, searches: 0, calls: 0 });

/** Reserva o gasto máximo da verificação ANTES de chamar a OpenAI. */
export async function reserveBudget(kv: KV, reserveUsd: number, now = Date.now()): Promise<{ ok: boolean; reason?: string }> {
  const L = limits();
  let verdict: { ok: boolean; reason?: string } = { ok: true };
  await update<Budget>(
    kv,
    `budget:${dayKey(now)}`,
    emptyBudget,
    (b) => {
      if (b.requests >= L.globalRequests) {
        verdict = { ok: false, reason: "Limite diário de verificações do serviço atingido. Tente amanhã." };
        return { abort: true };
      }
      if (b.spentUsd + b.reservedUsd + reserveUsd > L.dailyCostUsd) {
        verdict = { ok: false, reason: "Orçamento diário do serviço esgotado. Tente amanhã." };
        return { abort: true };
      }
      b.requests++;
      b.reservedUsd += reserveUsd;
      return b;
    },
  );
  return verdict;
}

/** Libera a reserva e registra o gasto real. */
export async function settleBudget(kv: KV, reserveUsd: number, actual: { costUsd: number; tokens: number; searches: number; calls: number }, now = Date.now()) {
  await update<Budget>(kv, `budget:${dayKey(now)}`, emptyBudget, (b) => {
    b.reservedUsd = Math.max(0, b.reservedUsd - reserveUsd);
    b.spentUsd += actual.costUsd;
    b.tokens += actual.tokens;
    b.searches += actual.searches;
    b.calls += actual.calls;
    return b;
  });
}

export async function budgetSnapshot(kv: KV, now = Date.now()) {
  const b = (await kv.get<Budget>(`budget:${dayKey(now)}`))?.value ?? emptyBudget();
  const L = limits();
  return { ...b, spentUsd: Math.round(b.spentUsd * 10000) / 10000, limitUsd: L.dailyCostUsd, limitRequests: L.globalRequests };
}
