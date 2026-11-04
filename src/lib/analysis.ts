import { modelOutputSchema, type ModelOutput, type Source } from "./schema";

/** Extrai e valida o JSON do texto do modelo. Retorna null se inválido (nunca fabrica resultado). */
export function parseModelJson(text: string): ModelOutput | null {
  if (!text) return null;
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = modelOutputSchema.safeParse(JSON.parse(body.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const WEIGHTS = {
  qualidade_evidencias: 0.3,
  fontes_independentes: 0.2,
  consistencia: 0.2,
  atualidade: 0.1,
  documentos_primarios: 0.2,
} as const;

/**
 * Índice de confiança (0-100) na conclusão, calculado por critérios explícitos (0-5) e pesos fixos.
 * Não é a probabilidade de a notícia ser verdadeira. Retorna null se faltarem critérios essenciais
 * ou se a busca não tiver retornado fontes reais.
 */
export function computeConfidence(criterios: ModelOutput["criterios"], realSourceCount: number): number | null {
  if (!criterios || realSourceCount === 0) return null;
  const essentials = [criterios.qualidade_evidencias, criterios.fontes_independentes, criterios.consistencia];
  if (essentials.some((v) => v == null)) return null;
  let total = 0;
  let weight = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    const v = criterios[k as keyof typeof WEIGHTS];
    if (v != null) {
      total += (v / 5) * w;
      weight += w;
    }
  }
  if (weight === 0) return null;
  let score = (total / weight) * 100;
  if (realSourceCount < 2) score = Math.min(score, 50); // uma única fonte não sustenta alta confiança
  return Math.round(score);
}

type Chunk = { web?: { uri?: string; title?: string } };
type Meta = { groundingChunks?: Chunk[] } | undefined;
type UrlMeta = { urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[] } | undefined;

function safeHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** Monta a lista de fontes SOMENTE a partir dos metadados reais retornados pela API. */
export function extractSources(meta: Meta, urlMeta: UrlMeta, notes: ModelOutput["notas_fontes"]): Source[] {
  const seen = new Set<string>();
  const out: Source[] = [];
  const findNote = (title: string, domain: string) => {
    const t = title.toLowerCase();
    const d = domain.toLowerCase();
    return notes.find((n) => {
      const nt = n.titulo.toLowerCase().trim();
      return nt && (t.includes(nt) || nt.includes(t) || nt.includes(d) || d.includes(nt));
    });
  };
  for (const c of meta?.groundingChunks ?? []) {
    const uri = c.web?.uri;
    if (!uri || !/^https?:\/\//i.test(uri) || seen.has(uri)) continue;
    seen.add(uri);
    const title = c.web?.title || uri;
    const dominio = title.includes(".") && !/\s/.test(title) ? title : safeHost(uri);
    const note = findNote(title, dominio);
    out.push({
      titulo: title,
      dominio,
      url: uri,
      relevancia: note?.relevancia ?? "Fonte consultada pela busca (sem nota de relevância).",
      data: note?.data,
    });
  }
  for (const u of urlMeta?.urlMetadata ?? []) {
    const uri = u.retrievedUrl;
    if (!uri || seen.has(uri) || !/^https?:\/\//i.test(uri)) continue;
    seen.add(uri);
    const ok = !u.urlRetrievalStatus || u.urlRetrievalStatus.includes("SUCCESS");
    out.push({
      titulo: safeHost(uri),
      dominio: safeHost(uri),
      url: uri,
      relevancia: ok ? "Página informada pelo usuário, lida pela IA." : "Página informada pelo usuário; a leitura falhou.",
    });
  }
  return out;
}
