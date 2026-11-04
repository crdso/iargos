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
- `GEMINI_MODEL`: padrão `gemini-2.5-flash`.
- Backend: `POST /api/verify` (validação Zod, bloqueio de URLs locais, rate limit, timeout de 90 s).
- Fontes exibidas vêm apenas dos metadados reais de grounding; o índice de confiança é calculado no servidor por critérios ponderados (`src/lib/analysis.ts`).

## Política editorial de verificação

As instruções de sistema do Gemini são carregadas **diretamente** de [`docs/POLITICA_DE_VERIFICACAO.md`](docs/POLITICA_DE_VERIFICACAO.md) pelo backend em `src/lib/gemini.ts`. Não basta criar o arquivo sem conectá-lo ao `systemInstruction`.

As três perguntas obrigatórias são **Quem criou?**, **Qual a fonte?** e **Qual o interesse?**. A política exige pesquisa por evidências favoráveis e contrárias e distinção entre fontes independentes e republicações. Em caso de evidência insuficiente, a saída correta é **Inconclusiva**, com limitações e referências reais extraídas da API.

**Atenção:** a política é um controle editorial, não uma prova técnica de independência das fontes. A implementação atual ainda exige testes reais com chave Gemini, validação do grounding e medidas determinísticas adicionais antes de disponibilizar o IArgos publicamente como checador de fatos de alta confiança. Uma contagem de URLs não prova corroboração independente.

A chave **não** deve ser enviada ao GitHub. Configure apenas `.env.local` localmente ou as variáveis de ambiente secretas da hospedagem.
