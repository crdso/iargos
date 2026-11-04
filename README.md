# IArgos

Plataforma educacional contra a desinformação: pesquisa e analisa notícias com Gemini (Google Search Grounding + URL Context).

## Rodar

```bash
npm install
cp .env.example .env.local   # preencha OPENAI_API_KEY (no Netlify: variável de ambiente)
npm run dev                  # http://localhost:3000
npm test
npm run build && npm start
```

- Provedor: **OpenAI Responses API** (SDK `openai`), modelo `OPENAI_MODEL` (padrão `gpt-5.4-mini`), ferramenta `web_search` obrigatória (`tool_choice: required`) e `include: web_search_call.action.sources`.
- Referências vêm só de `url_citation` e das fontes reais da busca. Sem chamada de busca real, nenhum veredito é emitido.
- Custo: tokens pela tabela do gpt-5.4-mini (US$ 0,75 / 0,075 cache / 4,50 por 1M) + US$ 0,01 por busca. Limites: `MAX_COST_PER_VERIFICATION_USD`, `MAX_WEB_SEARCHES`, `DAILY_COST_BUDGET_USD`, `DAILY_TOKEN_BUDGET`.
- Backend: `POST /api/verify` (Zod, bloqueio de URLs locais, rate limit, timeout de 90 s, sem retentativas pagas).

## Política editorial de verificação

As instruções de sistema são carregadas **diretamente** de [`docs/POLITICA_DE_VERIFICACAO.md`](docs/POLITICA_DE_VERIFICACAO.md) pelo backend em `src/lib/gemini.ts`. Não basta criar o arquivo sem conectá-lo ao `systemInstruction`.

As três perguntas obrigatórias são **Quem criou?**, **Qual a fonte?** e **Qual o interesse?**. A política exige pesquisa por evidências favoráveis e contrárias e distinção entre fontes independentes e republicações. Em caso de evidência insuficiente, a saída correta é **Inconclusiva**, com limitações e referências reais extraídas da API.

**Atenção:** a política é um controle editorial, não uma prova técnica de independência das fontes. A implementação atual ainda exige testes reais com chave Gemini, validação do grounding e medidas determinísticas adicionais antes de disponibilizar o IArgos publicamente como checador de fatos de alta confiança. Uma contagem de URLs não prova corroboração independente.

A chave **não** deve ser enviada ao GitHub. Configure apenas `.env.local` localmente ou as variáveis de ambiente secretas da hospedagem.

## Segunda camada de verificação (validação no servidor)

1. O modelo (com `web_search`) devolve uma **matriz de evidências** (`evidencias`): fonte, papel (primária / independente / republicação), posição (apoia / contradiz), origem comum e trecho.
2. `src/lib/verification.ts` valida a matriz **sem depender do texto do modelo**: descarta fontes que a busca não retornou, agrupa fontes com a mesma origem/domínio em uma só linha, ignora republicações e a página enviada pelo usuário, e só mantém um veredito categórico com 1 evidência primária decisiva ou ≥3 linhas independentes, sem contradição não resolvida. Notícia antiga reapresentada como recente vira "Enganosa ou fora de contexto". Caso contrário: **Inconclusiva**.
3. Uma **revisão crítica** (2ª chamada, sem busca) só pode reduzir a certeza. Não é chamada quando o veredito já é Inconclusiva/Não verificável.
4. Consumo: tokens e consultas de busca por chamada (`uso`), contadores diários, `DAILY_TOKEN_BUDGET`, cache em memória (hash, 30 min).

**Ainda não validado com chave real:** o modelo preencher a matriz de forma fiel e consistente, o casamento dos nomes de fontes com os metadados do grounding e calibração dos limiares (1 primária / 3 linhas). Testes atuais usam respostas simuladas.
