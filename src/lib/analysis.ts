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

type Ref = { url: string; title?: string };
type Refs = { citations: Ref[]; consulted: Ref[] };

function safeHost(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

/** Monta a lista de fontes SOMENTE a partir de url_citation e web_search_call.action.sources reais. */
export function extractSources(refs: Refs | undefined, notes: ModelOutput["notas_fontes"]): Source[] {
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
  const add = (r: Ref, cited: boolean) => {
    if (!r.url || !/^https?:\/\//i.test(r.url) || seen.has(r.url)) return;
    seen.add(r.url);
    const dominio = safeHost(r.url);
    const titulo = r.title?.trim() || dominio;
    const note = findNote(titulo, dominio);
    out.push({
      titulo,
      dominio,
      url: r.url,
      relevancia: note?.relevancia ?? (cited ? "Fonte citada pela IA (sem nota de relevância)." : "Página consultada na pesquisa, não citada diretamente."),
      data: note?.data,
      citada: cited,
    });
  };
  for (const c of refs?.citations ?? []) add(c, true);
  for (const c of refs?.consulted ?? []) add(c, false);
  return out;
}

/** Remove citações em markdown "([site](url))" e o rastreio utm_source que o modelo embute no texto. */
export function cleanText(t: string): string {
  return t
    .replace(/\s*\(\s*\[[^\]]*\]\([^)]*\)\s*\)/g, "")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/[?&]utm_source=openai/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Limita as fontes exibidas: citadas e as usadas na matriz primeiro, depois as demais até o máximo. */
export function limitSources<T extends Source>(fontes: T[], usadas: Set<string>, max = 15): T[] {
  const prio = fontes.filter((f) => f.citada || usadas.has(f.url));
  const rest = fontes.filter((f) => !(f.citada || usadas.has(f.url)));
  return [...prio, ...rest].slice(0, Math.max(max, prio.length > max ? max : max));
}
