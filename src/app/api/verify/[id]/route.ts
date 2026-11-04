import { NextResponse } from "next/server";
import { getKV } from "@/lib/store";
import { publicJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let kv;
  try {
    kv = await getKV();
  } catch {
    return NextResponse.json({ error: "Armazenamento indisponível." }, { status: 503 });
  }
  const job = await publicJob(kv, id);
  if (!job) return NextResponse.json({ error: "Verificação não encontrada." }, { status: 404 });
  return NextResponse.json(job, { headers: { "Cache-Control": "no-store" } });
}
