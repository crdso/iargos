import { NextResponse } from "next/server";
import { requestSchema } from "@/lib/schema";
import { extractUrl, isSafeUrl, rateLimit } from "@/lib/security";
import { runVerification, VerifyError } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const rl = rateLimit(ip);
  if (!rl.ok) return NextResponse.json({ error: rl.reason }, { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } });

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

  try {
    const result = await runVerification(input, url);
    console.info(`[iargos] ${result.classificacao} tokens=${result.uso.tokensTotal} buscas=${result.uso.consultasBusca} chamadas=${result.uso.chamadas} cache=${result.uso.cache}`);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof VerifyError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
    return NextResponse.json({ error: "Erro interno." }, { status: 500 });
  }
}
