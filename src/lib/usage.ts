import { createHash } from "node:crypto";
import type { Uso, VerifyResult } from "./schema";

type Day = { date: string; calls: number; tokens: number; searches: number; cacheHits: number };
let day: Day = { date: "", calls: 0, tokens: 0, searches: 0, cacheHits: 0 };

function roll(now = Date.now()) {
  const d = new Date(now).toISOString().slice(0, 10);
  if (day.date !== d) day = { date: d, calls: 0, tokens: 0, searches: 0, cacheHits: 0 };
}

export const dailyTokenBudget = () => Number(process.env.DAILY_TOKEN_BUDGET ?? 2_000_000);

export function budgetExceeded(now = Date.now()) {
  roll(now);
  return day.tokens >= dailyTokenBudget();
}

export function recordUsage(u: { tokens: number; searches: number }, now = Date.now()) {
  roll(now);
  day.calls++;
  day.tokens += u.tokens;
  day.searches += u.searches;
}

export function usageSnapshot() {
  roll();
  return { ...day, budget: dailyTokenBudget() };
}

export function resetUsage() {
  day = { date: "", calls: 0, tokens: 0, searches: 0, cacheHits: 0 };
  cache.clear();
}

/** Extrai tokens e consultas de busca de uma resposta do Gemini. */
export function readUsage(resp: { usageMetadata?: Record<string, unknown>; candidates?: { groundingMetadata?: { webSearchQueries?: string[] } }[] }) {
  const m = (resp.usageMetadata ?? {}) as Record<string, number | undefined>;
  const entrada = (m.promptTokenCount ?? 0) + (m.toolUsePromptTokenCount ?? 0);
  const saida = (m.candidatesTokenCount ?? 0) + (m.thoughtsTokenCount ?? 0);
  const buscas = resp.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
  return { entrada, saida, total: m.totalTokenCount ?? entrada + saida, buscas };
}

export function sumUso(parts: { entrada: number; saida: number; total: number; buscas: number }[], revisao: boolean): Uso {
  return {
    chamadas: parts.length,
    tokensEntrada: parts.reduce((a, p) => a + p.entrada, 0),
    tokensSaida: parts.reduce((a, p) => a + p.saida, 0),
    tokensTotal: parts.reduce((a, p) => a + p.total, 0),
    consultasBusca: parts.reduce((a, p) => a + p.buscas, 0),
    revisaoExecutada: revisao,
    cache: false,
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
