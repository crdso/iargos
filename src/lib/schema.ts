import { z } from "zod";

export const CLASSIFICACOES = [
  "Verdadeira",
  "Majoritariamente verdadeira",
  "Enganosa ou fora de contexto",
  "Majoritariamente falsa",
  "Falsa",
  "Inconclusiva",
  "Não verificável",
] as const;

export const requestSchema = z.object({
  input: z.string().trim().min(8, "Digite ao menos 8 caracteres.").max(6000, "Texto longo demais (máx. 6000 caracteres)."),
});

export const evidenciaSchema = z.object({
  fonte: z.string().min(1), // nome/site exatamente como aparece na busca
  alegacao_id: z.number().int().optional().default(1),
  papel: z.enum(["primaria", "independente", "republicacao"]),
  posicao: z.enum(["apoia", "contradiz", "neutra"]),
  origem_comum: z.string().optional().default(""), // de onde a informação desta fonte vem (cadeia de atribuição)
  data_fato: z.string().optional().default(""),
  data_publicacao: z.string().optional().default(""),
  trecho: z.string().optional().default(""),
});
// Critérios (0-5) informados pelo modelo; a pontuação final é calculada no servidor.
const criterio = z.number().min(0).max(5).nullable();
export const modelOutputSchema = z.object({
  resumo: z.string().min(1),
  classificacao: z.enum(CLASSIFICACOES),
  alegacao_principal: z.string().optional().default(""),
  criterios: z
    .object({
      qualidade_evidencias: criterio,
      fontes_independentes: criterio,
      consistencia: criterio,
      atualidade: criterio,
      documentos_primarios: criterio,
    })
    .nullable()
    .optional(),
  quem_criou: z.string().min(1),
  qual_a_fonte: z.string().min(1),
  qual_o_interesse: z.string().min(1),
  limitacoes: z.string().optional().default(""),
  evidencias: z.array(evidenciaSchema).optional().default([]),
  fato_antigo_republicado: z.boolean().optional().default(false),
  data_fato: z.string().optional().default(""),
  notas_fontes: z
    .array(z.object({ titulo: z.string(), relevancia: z.string(), data: z.string().optional() }))
    .optional()
    .default([]),
});
export type Evidencia = z.infer<typeof evidenciaSchema>;

export const reviewSchema = z.object({
  classificacao_revisada: z.enum(CLASSIFICACOES),
  objecoes: z.array(z.string()).optional().default([]),
});
export type Review = z.infer<typeof reviewSchema>;

export type ModelOutput = z.infer<typeof modelOutputSchema>;

export type Source = { titulo: string; dominio: string; url: string; relevancia: string; data?: string; papel?: string; posicao?: string; citada?: boolean };
export type MatrizLinha = { fonte: string; url: string | null; papel: string; posicao: string; origem: string; grounded: boolean; contaComoLinha: boolean; trecho: string };
export type Uso = { chamadas: number; tokensEntrada: number; tokensSaida: number; tokensTotal: number; consultasBusca: number; revisaoExecutada: boolean; cache: boolean; custoUsd: number; consultasEfetuadas?: string[] };
export type VerifyResult = {
  classificacao: (typeof CLASSIFICACOES)[number];
  resumo: string;
  alegacao: string;
  confianca: number | null;
  quemCriou: string;
  qualAFonte: string;
  qualOInteresse: string;
  limitacoes: string;
  fontes: Source[];
  verificadoEm: string;
  modelo: string;
  matriz: MatrizLinha[];
  linhasIndependentes: { apoio: number; contradicao: number; primariaApoio: boolean; primariaContradicao: boolean };
  validacoes: string[];
  uso: Uso;
};
