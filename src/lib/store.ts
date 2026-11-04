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

async function netlifyKV(): Promise<KV> {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "iargos", consistency: "strong" });
  return {
    kind: "netlify-blobs",
    async get<T>(key: string) {
      const r = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
      return r && r.etag ? { value: r.data as T, etag: r.etag } : null;
    },
    async put<T>(key: string, value: T, opt?: { ifNew?: boolean; ifMatch?: string }) {
      const r = await store.setJSON(key, value, opt?.ifNew ? { onlyIfNew: true } : opt?.ifMatch ? { onlyIfMatch: opt.ifMatch } : {});
      return { ok: r.modified, etag: r.etag };
    },
    async del(key: string) {
      await store.delete(key);
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
