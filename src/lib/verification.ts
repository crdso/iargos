import type { Evidencia, MatrizLinha, ModelOutput, Review, Source } from "./schema";

type Classificacao = ModelOutput["classificacao"];

const AFIRMATIVAS: Classificacao[] = ["Verdadeira", "Majoritariamente verdadeira"];
const NEGATIVAS: Classificacao[] = ["Falsa", "Majoritariamente falsa", "Enganosa ou fora de contexto"];
const CATEGORICAS: Classificacao[] = [...AFIRMATIVAS, ...NEGATIVAS];

export type ValidationInput = {
  parsed: Pick<ModelOutput, "classificacao" | "evidencias" | "fato_antigo_republicado" | "data_fato">;
  fontes: Source[]; // fontes reais (metadados do grounding)
  submittedUrl?: string | null; // a página enviada não corrobora a si mesma
  now?: Date;
  review?: Review | null;
};

export type ValidationOutput = {
  classificacao: Classificacao;
  matriz: MatrizLinha[];
  linhas: { apoio: number; contradicao: number; primariaApoio: boolean; primariaContradicao: boolean };
  confianca: number | null;
  motivos: string[]; // por que a classificação foi rebaixada
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .trim();

function registrable(host: string): string {
  const parts = norm(host).split("/")[0].split(".");
  if (parts.length <= 2) return parts.join(".");
  const last2 = parts.slice(-2).join(".");
  return /^(com|org|gov|net|edu)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join(".") : last2;
}

function hostOf(u?: string | null) {
  try {
    return u ? new URL(u).hostname : "";
  } catch {
    return "";
  }
}

/** Associa uma evidência declarada pelo modelo a uma fonte REAL retornada pela busca. */
export function matchSource(ev: Evidencia, fontes: Source[]): Source | null {
  const f = norm(ev.fonte);
  if (!f) return null;
  return (
    fontes.find((s) => {
      const t = norm(s.titulo);
      const d = norm(s.dominio);
      return t === f || d === f || (f.length >= 4 && (t.includes(f) || f.includes(t) || d.includes(f) || f.includes(d)));
    }) ?? null
  );
}

function parseDate(s: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Critérios técnicos determinísticos. O modelo propõe a matriz; o servidor decide se a classificação
 * categórica é sustentável. Só se pode REBAIXAR certeza aqui, nunca aumentá-la.
 */
export function applyValidators({ parsed, fontes, submittedUrl, now = new Date(), review }: ValidationInput): ValidationOutput {
  const motivos: string[] = [];
  const submittedHost = submittedUrl ? registrable(hostOf(submittedUrl)) : "";

  const matriz: MatrizLinha[] = [];
  const groupsApoio = new Set<string>();
  const groupsContra = new Set<string>();
  let primariaApoio = false;
  let primariaContra = false;
  let republicacoesApoio = 0;
  let apoioN = 0;
  let contraN = 0;
  let datasAntigas = false;

  for (const ev of parsed.evidencias) {
    const src = matchSource(ev, fontes);
    const grounded = !!src;
    const domain = src ? registrable(src.dominio || hostOf(src.url)) : registrable(ev.fonte);
    const selfRef = !!submittedHost && domain === submittedHost;
    // A origem comum agrupa fontes que dependem da mesma cadeia de atribuição.
    const origem = norm(ev.origem_comum) || domain;
    let conta = grounded && !selfRef && ev.papel !== "republicacao" && ev.posicao !== "neutra";
    if (ev.papel === "republicacao" && ev.posicao === "apoia") republicacoesApoio++;
    if (conta) {
      const group = origem;
      if (ev.posicao === "apoia") {
        // mesma origem ou mesmo domínio = uma única linha
        if (groupsApoio.has(group) || groupsApoio.has("d:" + domain)) conta = false;
        else {
          groupsApoio.add(group);
          groupsApoio.add("d:" + domain);
          apoioN++;
        }
      } else if (groupsContra.has(group) || groupsContra.has("d:" + domain)) conta = false;
      else {
        groupsContra.add(group);
        groupsContra.add("d:" + domain);
        contraN++;
      }
    }
    if (conta && ev.papel === "primaria") {
      if (ev.posicao === "apoia") primariaApoio = true;
      else primariaContra = true;
    }
    const fato = parseDate(ev.data_fato || parsed.data_fato);
    if (ev.posicao === "apoia" && fato && now.getTime() - fato.getTime() > 180 * 86_400_000) datasAntigas = true;
    matriz.push({ fonte: ev.fonte, url: src?.url ?? null, papel: ev.papel, posicao: ev.posicao, origem, grounded, contaComoLinha: conta, trecho: ev.trecho });
  }

  const linhas = { apoio: apoioN, contradicao: contraN, primariaApoio, primariaContradicao: primariaContra };
  const temData = !!parseDate(parsed.data_fato) || parsed.evidencias.some((e) => !!parseDate(e.data_fato));

  let cls: Classificacao = parsed.classificacao;
  const downgrade = (to: Classificacao, why: string) => {
    cls = to;
    motivos.push(why);
  };

  if (CATEGORICAS.includes(cls)) {
    const afirma = AFIRMATIVAS.includes(cls);
    const lado = afirma ? { n: linhas.apoio, p: primariaApoio } : { n: linhas.contradicao, p: primariaContra };
    const outro = afirma ? { n: linhas.contradicao, p: primariaContra } : { n: linhas.apoio, p: primariaApoio };

    if (matriz.filter((m) => m.grounded).length === 0) {
      downgrade("Inconclusiva", "Nenhuma evidência da matriz corresponde a uma fonte real retornada pela busca.");
    } else if (!(lado.p || lado.n >= 3)) {
      const rep = afirma && republicacoesApoio > 0 ? ` (${republicacoesApoio} republicação(ões) não contam como corroboração independente)` : "";
      downgrade(
        "Inconclusiva",
        `Corroboração insuficiente: ${lado.n} linha(s) independente(s) e ${lado.p ? "com" : "sem"} evidência primária; exige-se 1 evidência primária decisiva ou 3 linhas independentes${rep}.`,
      );
    } else if (outro.n >= 1 && !(lado.p && !outro.p)) {
      downgrade("Inconclusiva", "Há fontes independentes contraditórias sem evidência primária que resolva o conflito.");
    }

    if (afirma && parsed.fato_antigo_republicado && (datasAntigas || !temData)) {
      downgrade("Enganosa ou fora de contexto", "O fato é antigo (mais de 180 dias) e está sendo apresentado como recente.");
    }
  }

  // Revisão crítica: só pode tornar o veredito MENOS categórico.
  if (review && review.classificacao_revisada !== cls) {
    const r = review.classificacao_revisada;
    const menosCategorica = r === "Inconclusiva" || r === "Não verificável" || (r === "Enganosa ou fora de contexto" && AFIRMATIVAS.includes(cls));
    if (menosCategorica) downgrade(r, `Revisão crítica: ${review.objecoes.slice(0, 3).join(" | ") || "objeções às evidências."}`);
  }

  const incerta = cls === "Inconclusiva" || cls === "Não verificável";
  return { classificacao: cls, matriz, linhas, confianca: incerta ? null : confidence(linhas, matriz, parsed, now), motivos };
}

/** Índice (0–100) derivado só da matriz validada; não é probabilidade de veracidade. */
function confidence(
  l: ValidationOutput["linhas"],
  matriz: MatrizLinha[],
  parsed: ValidationInput["parsed"],
  now: Date,
): number | null {
  const principal = AFIRMATIVAS.includes(parsed.classificacao) ? l.primariaApoio : l.primariaContradicao;
  const n = AFIRMATIVAS.includes(parsed.classificacao) ? l.apoio : l.contradicao;
  const contra = AFIRMATIVAS.includes(parsed.classificacao) ? l.contradicao : l.apoio;
  if (n === 0) return null;
  let score = 35 + Math.min(n, 4) * 8 + (principal ? 25 : 0);
  if (contra > 0) score -= 15;
  if (matriz.length === 0) return null;
  const fato = parseDate(parsed.data_fato);
  if (fato && now.getTime() - fato.getTime() > 3 * 365 * 86_400_000) score -= 5;
  return Math.max(0, Math.min(95, Math.round(score)));
}
