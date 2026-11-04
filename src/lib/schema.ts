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
  notas_fontes: z
    .array(z.object({ titulo: z.string(), relevancia: z.string(), data: z.string().optional() }))
    .optional()
    .default([]),
});
export type ModelOutput = z.infer<typeof modelOutputSchema>;

export type Source = { titulo: string; dominio: string; url: string; relevancia: string; data?: string };
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
};
