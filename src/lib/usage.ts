import { createHash } from "node:crypto";
import type { Uso, VerifyResult } from "./schema";

type Day = { date: string; calls: number; tokens: number; searches: number; cacheHits: number; cost: number };
let day: Day = { date: "", calls: 0, tokens: 0, searches: 0, cacheHits: 0, cost: 0 };

function roll(now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (day.date !== d) day = { date: d, calls: 0, tokens: 0, searches: 0, cacheHits: 0, cost: 0 };
}

export const dailyTokenBudget = () => Number(process.env.DAILY_TOKEN_BUDGET ?? 3_000_000);
export const dailyCostBudget = () => Number(process.env.DAILY_COST_BUDGET_USD ?? 5);

export function budgetExceeded(now = Date.now()) {
  roll(now);
  return day.tokens >= dailyTokenBudget() || day.cost >= dailyCostBudget();
}

export function recordUsage(u: { tokens: number; searches: number; costUsd?: number }, now = Date.now()) {
  roll(now);
  day.calls++;
  day.tokens += u.tokens;
  day.searches += u.searches;
  day.cost += u.costUsd ?? 0;
}

export function usageSnapshot() {
  roll();
  return { ...day, budget: dailyTokenBudget(), costBudget: dailyCostBudget() };
}

export function resetUsage() {
  day = { date: "", calls: 0, tokens: 0, searches: 0, cacheHits: 0, cost: 0 };
  cache.clear();
}

export type Normalized = {
  status: string;
  text: string;
  entrada: number;
  saida: number;
  total: number;
  cached: number;
  searchCalls: number; // chamadas web_search (ação "search") realmente executadas
  queries: string[];
  consulted: { url: string; title?: string }[]; // web_search_call.action.sources
  citations: { url: string; title?: string }[]; // anotações url_citation
};

/** Remove o parâmetro de rastreio que a OpenAI acrescenta às URLs. */
export function cleanUrl(u: string): string {
  try {
    const x = new URL(u);
    x.searchParams.delete("utm_source");
    return x.toString().replace(/\?$/, "");
  } catch {
    return u;
  }
}

/** Converte uma resposta bruta da Responses API em uma estrutura estável. Não presume nenhum campo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalizeResponse(raw: any): Normalized {
  const out = Array.isArray(raw?.output) ? raw.output : [];
  let text = "";
  const citations: Normalized["citations"] = [];
  const consulted: Normalized["consulted"] = [];
  const queries: string[] = [];
  let searchCalls = 0;
  for (const item of out) {
    if (item?.type === "web_search_call") {
      const act = item.action ?? {};
      if ((act.type ?? "search") === "search") {
        searchCalls++;
        const qs: unknown[] = Array.isArray(act.queries) ? act.queries : act.query ? [act.query] : [];
        for (const q of qs) if (typeof q === "string") queries.push(q);
      }
      for (const src of Array.isArray(act.sources) ? act.sources : []) {
        if (typeof src?.url === "string") consulted.push({ url: cleanUrl(src.url), title: typeof src.title === "string" ? src.title : undefined });
      }
    } else if (item?.type === "message") {
      for (const c of Array.isArray(item.content) ? item.content : []) {
        if (c?.type === "output_text") {
          text += c.text ?? "";
          for (const an of Array.isArray(c.annotations) ? c.annotations : []) {
            if (an?.type === "url_citation" && typeof an.url === "string") citations.push({ url: cleanUrl(an.url), title: typeof an.title === "string" ? an.title : undefined });
          }
        }
      }
    }
  }
  if (!text && typeof raw?.output_text === "string") text = raw.output_text;
  const u = raw?.usage ?? {};
  const entrada = u.input_tokens ?? 0;
  const saida = u.output_tokens ?? 0;
  return {
    status: raw?.status ?? "completed",
    text,
    entrada,
    saida,
    total: u.total_tokens ?? entrada + saida,
    cached: u.input_tokens_details?.cached_tokens ?? 0,
    searchCalls,
    queries,
    consulted,
    citations,
  };
}

// Tabela oficial de preços (US$ por 1M de tokens) e da ferramenta web_search (US$ por chamada).
export const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  "gpt-5.4-mini": { in: 0.75, cached: 0.075, out: 4.5 },
};
export const SEARCH_CALL_USD = 10 / 1000;

export function estimateCost(n: Normalized, model: string) {
  const p = PRICES[model] ?? PRICES["gpt-5.4-mini"];
  const tokens = ((n.entrada - n.cached) * p.in + n.cached * p.cached + n.saida * p.out) / 1_000_000;
  const search = n.searchCalls * SEARCH_CALL_USD;
  return { tokens, search, total: tokens + search, tabelaConhecida: model in PRICES };
}

export function sumUso(parts: Normalized[], revisao: boolean, model: string): Uso {
  const cost = parts.reduce((a, n) => a + estimateCost(n, model).total, 0);
  return {
    chamadas: parts.length,
    tokensEntrada: parts.reduce((a, p) => a + p.entrada, 0),
    tokensSaida: parts.reduce((a, p) => a + p.saida, 0),
    tokensTotal: parts.reduce((a, p) => a + p.total, 0),
    consultasBusca: parts.reduce((a, p) => a + p.searchCalls, 0),
    revisaoExecutada: revisao,
    cache: false,
    custoUsd: Math.round(cost * 10000) / 10000,
  };
}

// Cache em memória, só com hash da entrada (nada pessoal é guardado em texto), TTL curto.
const cache = new Map<string, { at: number; value: VerifyResult }>();
const TTL = 30 * 60_000;
export const cacheKey = (input: string) => createHash("sha256").update(input.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");

export function cacheGet(key: string, now = Date.now()): VerifyResult | null {
  const hit = cache.get(key);
  if (!hit || now - hit.at > TTL) return null;
  roll(now);
  day.cacheHits++;
  return { ...hit.value, uso: { ...hit.value.uso, cache: true } };
}

export function cacheSet(key: string, value: VerifyResult, now = Date.now()) {
  if (cache.size > 300) cache.clear();
  cache.set(key, { at: now, value });
}
