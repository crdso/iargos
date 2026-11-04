import { NextResponse } from "next/server";
import { getKV } from "@/lib/store";
import { budgetSnapshot, limits } from "@/lib/guards";
import { getModel } from "@/lib/openai";

export const dynamic = "force-dynamic";

/** Diagnóstico sem segredos: presença das variáveis, tipo de armazenamento e orçamento do dia. */
export async function GET() {
  let store: string = "indisponível";
  let budget = null;
  try {
    const kv = await getKV();
    store = kv.kind;
    budget = await budgetSnapshot(kv);
  } catch {}
  return NextResponse.json(
    {
      openaiKeyConfigured: !!process.env.OPENAI_API_KEY,
      model: getModel(),
      store,
      sharedProtection: store === "netlify-blobs",
      limits: limits(),
      budget,
      commit: (process.env.COMMIT_REF ?? "").slice(0, 7) || null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
