# IArgos

Plataforma educacional contra a desinformação: pesquisa e analisa notícias com Gemini (Google Search Grounding + URL Context).

## Rodar

```bash
npm install
cp .env.example .env.local   # preencha GEMINI_API_KEY
npm run dev                  # http://localhost:3000
npm test
npm run build && npm start
```

- `GEMINI_API_KEY`: chave em https://aistudio.google.com/apikey (só no backend).
- `GEMINI_MODEL`: padrão `gemini-3.6-flash`.
- Backend: `POST /api/verify` (validação Zod, bloqueio de URLs locais, rate limit, timeout de 90 s).
- Fontes exibidas vêm apenas dos metadados reais de grounding; o índice de confiança é calculado no servidor por critérios ponderados (`src/lib/analysis.ts`).

## Política editorial de verificação

As instruções de sistema do Gemini são carregadas **diretamente** de [`docs/POLITICA_DE_VERIFICACAO.md`](docs/POLITICA_DE_VERIFICACAO.md) pelo backend em `src/lib/gemini.ts`. Não basta criar o arquivo sem conectá-lo ao `systemInstruction`.

As três perguntas obrigatórias são **Quem criou?**, **Qual a fonte?** e **Qual o interesse?**. A política exige pesquisa por evidências favoráveis e contrárias e distinção entre fontes independentes e republicações. Em caso de evidência insuficiente, a saída correta é **Inconclusiva**, com limitações e referências reais extraídas da API.

**Atenção:** a política é um controle editorial, não uma prova técnica de independência das fontes. A implementação atual ainda exige testes reais com chave Gemini, validação do grounding e medidas determinísticas adicionais antes de disponibilizar o IArgos publicamente como checador de fatos de alta confiança. Uma contagem de URLs não prova corroboração independente.

A chave **não** deve ser enviada ao GitHub. Configure apenas `.env.local` localmente ou as variáveis de ambiente secretas da hospedagem.

## Segunda camada de verificação (validação no servidor)

1. O Gemini (com Google Search Grounding) devolve uma **matriz de evidências** (`evidencias`): fonte, papel (primária / independente / republicação), posição (apoia / contradiz), origem comum e trecho.
2. `src/lib/verification.ts` valida a matriz **sem depender do texto do modelo**: descarta fontes que a busca não retornou, agrupa fontes com a mesma origem/domínio em uma só linha, ignora republicações e a página enviada pelo usuário, e só mantém um veredito categórico com 1 evidência primária decisiva ou ≥3 linhas independentes, sem contradição não resolvida. Notícia antiga reapresentada como recente vira "Enganosa ou fora de contexto". Caso contrário: **Inconclusiva**.
3. Uma **revisão crítica** (2ª chamada, sem busca) só pode reduzir a certeza. Não é chamada quando o veredito já é Inconclusiva/Não verificável.
4. Consumo: tokens e consultas de busca por chamada (`uso`), contadores diários, `DAILY_TOKEN_BUDGET`, cache em memória (hash, 30 min).

**Ainda não validado com chave real:** o modelo preencher a matriz de forma fiel e consistente, o casamento dos nomes de fontes com os metadados do grounding (os links são redirecionamentos da Google), o formato real de `usageMetadata`/`webSearchQueries`, custo real por consulta e calibração dos limiares (1 primária / 3 linhas). Testes atuais usam respostas simuladas.
