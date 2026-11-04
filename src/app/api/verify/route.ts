import { NextResponse } from "next/server";
import { requestSchema } from "@/lib/schema";
import { extractUrl, isSafeUrl } from "@/lib/security";
import { getKV } from "@/lib/store";
import { rateLimitShared, reserveBudget, settleBudget } from "@/lib/guards";
import { cacheGetShared, createJob, findInflight, hashInput, reserveAmount, runJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const input = parsed.data.input;
  const url = extractUrl(input);
  if (url && !isSafeUrl(url)) return NextResponse.json({ error: "URL inválida ou não permitida (use http/https público)." }, { status: 400 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "API não configurada: defina OPENAI_API_KEY.", code: "not_configured" }, { status: 503 });

  let kv;
  try {
    kv = await getKV();
  } catch {
    return NextResponse.json({ error: "Armazenamento de proteção indisponível; verificações suspensas por segurança.", code: "store_unavailable" }, { status: 503 });
  }

  const ip = req.headers.get("x-nf-client-connection-ip") ?? (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const rl = await rateLimitShared(kv, ip);
  if (!rl.ok) return NextResponse.json({ error: rl.reason }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });

  const hash = hashInput(url ?? input);
  const cached = await cacheGetShared(kv, hash);
  if (cached) return NextResponse.json({ status: "done", result: cached });
  const inflight = await findInflight(kv, hash);
  if (inflight) return NextResponse.json({ status: "queued", jobId: inflight }, { status: 202 });

  const reserve = reserveAmount();
  const budget = await reserveBudget(kv, reserve);
  if (!budget.ok) return NextResponse.json({ error: budget.reason, code: "budget" }, { status: 429 });

  const job = await createJob(kv, hash, reserve);
  const payload = { id: job.id, nonce: job.nonce, input: url ?? input, url };
  if (kv.kind === "netlify-blobs") {
    try {
      const r = await fetch(`${new URL(req.url).origin}/.netlify/functions/verify-background`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (r.status !== 202 && r.status !== 200) throw new Error(`HTTP ${r.status}`);
    } catch (e) {
      console.error("[iargos] falha ao acionar função em segundo plano:", e instanceof Error ? e.message : e);
      await settleBudget(kv, reserve, { costUsd: 0, tokens: 0, searches: 0, calls: 0 });
      await kv.put(`job:${job.id}`, { ...job, status: "failed", updatedAt: Date.now(), error: { message: "Não foi possível iniciar a análise. Tente novamente.", code: "trigger", status: 502 } });
      return NextResponse.json({ error: "Não foi possível iniciar a análise. Tente novamente.", code: "trigger" }, { status: 502 });
    }
  } else {
    void runJob(kv, payload); // desenvolvimento local: executa no próprio processo
  }
  return NextResponse.json({ status: "queued", jobId: job.id }, { status: 202 });
}
