import { NextResponse } from "next/server";
import { getKV } from "@/lib/store";
import { budgetSnapshot, limits } from "@/lib/guards";
import { getModel } from "@/lib/openai";

export const dynamic = "force-dynamic";

/** Diagnóstico sem segredos: presença das variáveis, tipo de armazenamento e orçamento do dia. */
async function blobsDiag() {
  const out: Record<string, unknown> = {};
  try {
    const ctx = JSON.parse(Buffer.from(process.env.NETLIFY_BLOBS_CONTEXT ?? "", "base64").toString("utf8"));
    out.contextKeys = Object.keys(ctx);
    const host = (u?: string) => { try { return new URL(u!).host; } catch { return null; } };
    out.hosts = { edge: host(ctx.edgeURL), uncached: host(ctx.uncachedEdgeURL), api: host(ctx.apiURL) };
  } catch (e) { out.contextError = String(e).slice(0, 100); }
  for (const u of ["https://edge.netlifyblobs.com/", "https://api.netlify.com/api/v1/", "https://api.openai.com/v1/models"]) {
    const t0 = Date.now();
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
      out["net " + new URL(u).host] = `HTTP ${r.status} ${Date.now() - t0}ms`;
    } catch (e) { out["net " + new URL(u).host] = `erro ${(e instanceof Error ? e.message : String(e)).slice(0, 80)} (${Date.now() - t0}ms)`; }
  }
  const { getStore } = await import("@netlify/blobs");
  for (const consistency of ["eventual", "strong"] as const) {
    const t0 = Date.now();
    try {
      const st = getStore({ name: "iargos", consistency });
      await Promise.race([st.get("ping"), new Promise((_, r) => setTimeout(() => r(new Error("timeout 4s")), 4000))]);
      out[consistency] = `ok ${Date.now() - t0}ms`;
    } catch (e) { out[consistency] = `erro ${(e instanceof Error ? e.message : String(e)).slice(0, 120)} (${Date.now() - t0}ms)`; }
  }
  return out;
}

export async function GET(req: Request) {
  let store: string = "indisponível";
  let budget = null;
  let storeError: string | null = null;
  try {
    const kv = await getKV();
    store = kv.kind;
    budget = await budgetSnapshot(kv);
  } catch (e) {
    storeError = (e instanceof Error ? e.message : String(e)).slice(0, 200);
  }
  const diag = new URL(req.url).searchParams.has("diag") ? await blobsDiag() : undefined;
  return NextResponse.json(
    {
      diag,
      openaiKeyConfigured: !!process.env.OPENAI_API_KEY,
      model: getModel(),
      store,
      storeError,
      env: { NETLIFY: !!process.env.NETLIFY, blobsContext: !!process.env.NETLIFY_BLOBS_CONTEXT, runtime: process.env.AWS_LAMBDA_FUNCTION_NAME ? "lambda" : "other" },
      sharedProtection: store === "netlify-blobs",
      limits: limits(),
      budget,
      commit: (process.env.COMMIT_REF ?? "").slice(0, 7) || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
