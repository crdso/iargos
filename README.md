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
