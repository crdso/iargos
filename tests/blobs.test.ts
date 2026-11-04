import { afterEach, describe, expect, it, vi } from "vitest";
import { netlifyKV, update } from "@/lib/store";

// Servidor falso da API HTTP do Netlify Blobs: etag, If-Match, If-None-Match, 404/412.
function fakeBlobs() {
  const m = new Map<string, { body: string; n: number }>();
  let n = 0;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = decodeURIComponent(new URL(String(input)).pathname.split("/").pop()!);
    const h = new Headers(init?.headers);
    expect(h.get("authorization")).toMatch(/^Bearer /);
    const cur = m.get(key);
    const method = init?.method ?? "GET";
    if (method === "GET") return cur ? new Response(cur.body, { status: 200, headers: { etag: `"${cur.n}"` } }) : new Response("<Error/>", { status: 404 });
    if (method === "PUT") {
      if (h.get("if-none-match") === "*" && cur) return new Response("", { status: 412 });
      if (h.get("if-match") && (!cur || `"${cur.n}"` !== h.get("if-match"))) return new Response("", { status: 412 });
      const next = ++n;
      m.set(key, { body: String(init!.body), n: next });
      return new Response("", { status: 200, headers: { etag: `"${next}"` } });
    }
    m.delete(key);
    return new Response("", { status: 204 });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NETLIFY_BLOBS_CONTEXT;
});

describe("cliente HTTP do Netlify Blobs", () => {
  it("lê, cria só se novo, atualiza com etag e detecta conflito; updates concorrentes não perdem contagem", async () => {
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ uncachedEdgeURL: "https://edge-uncached.test", siteID: "site1", token: "t0ken" })).toString("base64");
    const f = fakeBlobs();
    vi.stubGlobal("fetch", f);
    const kv = await netlifyKV();
    expect(kv.kind).toBe("netlify-blobs");
    expect(await kv.get("a")).toBeNull();
    const c = await kv.put("a", { v: 1 }, { ifNew: true });
    expect(c.ok).toBe(true);
    expect((await kv.put("a", { v: 2 }, { ifNew: true })).ok).toBe(false);
    const cur = await kv.get<{ v: number }>("a");
    expect(cur?.value).toEqual({ v: 1 });
    expect((await kv.put("a", { v: 3 }, { ifMatch: "stale" })).ok).toBe(false);
    expect((await kv.put("a", { v: 3 }, { ifMatch: cur!.etag })).ok).toBe(true);
    await Promise.all(Array.from({ length: 15 }, () => update(kv, "n", () => ({ n: 0 }), (x) => ({ n: x.n + 1 }))));
    expect((await kv.get<{ n: number }>("n"))!.value.n).toBe(15);
    // chave codificada na URL e token só no cabeçalho
    expect(f.mock.calls.every(([u]) => !String(u).includes("t0ken"))).toBe(true);
  });
  it("falha de forma explícita sem contexto", async () => {
    await expect(netlifyKV()).rejects.toThrow(/NETLIFY_BLOBS_CONTEXT/);
  });
});
