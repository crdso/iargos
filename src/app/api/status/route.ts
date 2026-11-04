import { NextResponse } from "next/server";
import { getKV } from "@/lib/store";
import { budgetSnapshot, limits } from "@/lib/guards";
import { getModel } from "@/lib/openai";

export const dynamic = "force-dynamic";

/** Diagnóstico sem segredos: presença das variáveis, tipo de armazenamento e orçamento do dia. */
export async function GET() {
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
  return NextResponse.json(
    {
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
