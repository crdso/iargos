/**
 * Armazenamento chave-valor compartilhado entre instâncias (Netlify Blobs) com escrita condicional (CAS).
 * Fora do Netlify cai para memória do processo (desenvolvimento/testes) e se identifica como "memory".
 */
export type Versioned<T> = { value: T; etag: string };
export interface KV {
  kind: "netlify-blobs" | "memory";
  get<T>(key: string): Promise<Versioned<T> | null>;
  /** ifNew: só cria; ifMatch: só atualiza se o etag for o lido. Retorna ok=false em conflito. */
  put<T>(key: string, value: T, opt?: { ifNew?: boolean; ifMatch?: string }): Promise<{ ok: boolean; etag?: string }>;
  del(key: string): Promise<void>;
}

export function memoryKV(): KV {
  const m = new Map<string, { v: string; n: number }>();
  let counter = 0;
  return {
    kind: "memory",
    async get<T>(key: string) {
      const e = m.get(key);
      return e ? { value: JSON.parse(e.v) as T, etag: String(e.n) } : null;
    },
    async put<T>(key: string, value: T, opt?: { ifNew?: boolean; ifMatch?: string }) {
      const cur = m.get(key);
      if (opt?.ifNew && cur) return { ok: false };
      if (opt?.ifMatch !== undefined && (!cur || String(cur.n) !== opt.ifMatch)) return { ok: false };
      const n = ++counter;
      m.set(key, { v: JSON.stringify(value), n });
      return { ok: true, etag: String(n) };
    },
    async del(key: string) {
      m.delete(key);
    },
  };
}

/**
 * Cliente mínimo da API HTTP do Netlify Blobs (contexto injetado em NETLIFY_BLOBS_CONTEXT).
 * Usamos fetch direto porque o SDK @netlify/blobs travava neste runtime (ver /api/status?diag).
 */
export async function netlifyKV(): Promise<KV> {
  const raw = process.env.NETLIFY_BLOBS_CONTEXT;
  if (!raw) throw new Error("NETLIFY_BLOBS_CONTEXT ausente");
  const ctx = JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as { uncachedEdgeURL?: string; edgeURL?: string; siteID: string; token: string };
  const base = ctx.uncachedEdgeURL ?? ctx.edgeURL;
  if (!base || !ctx.siteID || !ctx.token) throw new Error("Contexto do Netlify Blobs incompleto");
  const url = (key: string) => `${base.replace(/\/$/, "")}/${ctx.siteID}/site:iargos/${encodeURIComponent(key)}`;
  const h = (extra: Record<string, string> = {}) => ({ authorization: `Bearer ${ctx.token}`, ...extra });
  const sig = () => AbortSignal.timeout(6000);
  return {
    kind: "netlify-blobs",
    async get<T>(key: string) {
      const r = await fetch(url(key), { headers: h(), signal: sig() });
      if (r.status === 404) {
        await r.text();
        return null;
      }
      if (!r.ok) throw new Error(`Netlify Blobs GET ${r.status}`);
      const etag = r.headers.get("etag");
      const value = (await r.json()) as T;
      return etag ? { value, etag } : null;
    },
    async put<T>(key: string, value: T, opt?: { ifNew?: boolean; ifMatch?: string }) {
      const headers = h({ "content-type": "application/json", "cache-control": "max-age=0, stale-while-revalidate=60" });
      if (opt?.ifMatch) (headers as Record<string, string>)["if-match"] = opt.ifMatch;
      else if (opt?.ifNew) (headers as Record<string, string>)["if-none-match"] = "*";
      const r = await fetch(url(key), { method: "PUT", headers, body: JSON.stringify(value), signal: sig() });
      await r.text();
      if (r.status === 412 || r.status === 409) return { ok: false };
      if (!r.ok) throw new Error(`Netlify Blobs PUT ${r.status}`);
      return { ok: true, etag: r.headers.get("etag") ?? undefined };
    },
    async del(key: string) {
      const r = await fetch(url(key), { method: "DELETE", headers: h(), signal: sig() });
      await r.text();
    },
  };
}

let cached: Promise<KV> | null = null;
let fallback: KV | null = null;

/** Usa Netlify Blobs quando o ambiente existe; caso contrário memória (nunca silenciosamente no Netlify: ver /api/status). */
export function getKV(): Promise<KV> {
  if (!cached) {
    cached = (async () => {
      const onNetlify = !!(process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_LOCAL);
      if (onNetlify) {
        try {
          return await netlifyKV();
        } catch (e) {
          console.error("[iargos] Netlify Blobs indisponível:", e instanceof Error ? e.message : e);
          throw e; // no Netlify, não degradar para memória: as proteções precisam ser compartilhadas
        }
      }
      return (fallback ??= memoryKV());
    })();
    cached.catch(() => (cached = null));
  }
  return cached;
}

export function __setKVForTests(kv: KV | null) {
  cached = kv ? Promise.resolve(kv) : null;
}

/** Lê-modifica-escreve com retentativas em caso de conflito (CAS). */
export async function update<T>(kv: KV, key: string, init: () => T, fn: (cur: T) => T | { abort: true }, tries = 40): Promise<{ value: T; aborted: boolean }> {
  for (let i = 0; i < tries; i++) {
    const cur = await kv.get<T>(key);
    const base = cur ? cur.value : init();
    const next = fn(structuredClone(base));
    if (next && typeof next === "object" && "abort" in (next as object) && (next as { abort?: boolean }).abort === true) return { value: base, aborted: true };
    const r = await kv.put(key, next as T, cur ? { ifMatch: cur.etag } : { ifNew: true });
    if (r.ok) return { value: next as T, aborted: false };
    await new Promise((res) => setTimeout(res, Math.random() * 15 * Math.min(i + 1, 6))); // jitter para reduzir colisões
  }
  throw new Error("Conflito de escrita persistente no armazenamento compartilhado.");
}
