// Netlify Background Function (até 15 min): executa a verificação sem o limite de ~26 s das funções síncronas.
// Só roda jobs criados pela rota /api/verify (nonce secreto + hash da entrada) e uma única vez por job.
import { getKV } from "../../src/lib/store";
import { runJob } from "../../src/lib/jobs";

export default async (req: Request) => {
  let body: { id?: string; nonce?: string; input?: string; url?: string | null };
  try {
    body = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!body.id || !body.nonce || typeof body.input !== "string") return new Response("bad request", { status: 400 });
  const kv = await getKV();
  const r = await runJob(kv, { id: body.id, nonce: body.nonce, input: body.input, url: body.url ?? null });
  return new Response(r.ran ? "ok" : "ignored", { status: 202 });
};
