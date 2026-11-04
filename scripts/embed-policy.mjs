// Embute docs/POLITICA_DE_VERIFICACAO.md no código (funções serverless não dependem do sistema de arquivos).
import { readFileSync, writeFileSync } from "node:fs";
const md = readFileSync(new URL("../docs/POLITICA_DE_VERIFICACAO.md", import.meta.url), "utf8");
writeFileSync(new URL("../src/lib/policy.generated.ts", import.meta.url), `// GERADO por scripts/embed-policy.mjs a partir de docs/POLITICA_DE_VERIFICACAO.md. Não edite.\nexport const POLICY = ${JSON.stringify(md)};\n`);
