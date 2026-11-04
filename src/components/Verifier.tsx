"use client";

import { useRef, useState } from "react";
import { Scale, FileText, Search, User, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import type { VerifyResult } from "@/lib/schema";

const CARDS = [
  { icon: User, title: "QUEM CRIOU?", lines: ["A identidade e credibilidade", "de quem fala."] },
  { icon: FileText, title: "QUAL A FONTE?", lines: ["De onde vem a informação?", "É oficial?"] },
  { icon: Scale, title: "QUAL O INTERESSE?", lines: ["Quais os possíveis motivos", "ou viés?"] },
];

const TONE: Record<string, string> = {
  Verdadeira: "#1f8a4c",
  "Majoritariamente verdadeira": "#4c9a2a",
  "Enganosa ou fora de contexto": "#c27a00",
  "Majoritariamente falsa": "#c2561a",
  Falsa: "#c0392b",
  Inconclusiva: "#515b68",
  "Não verificável": "#515b68",
};

const INFO: Record<string, { t: string; body: React.ReactNode }> = {
  sobre: {
    t: "Sobre nós",
    body: (
      <>
        <p>
          O IArgoss é uma plataforma educacional contra a desinformação. O nome vem de Argos, o gigante grego dos muitos olhos e da vigilância constante; o mascote
          representa essa vigilância de forma tecnológica.
        </p>
        <p>Incentivamos a alfabetização midiática, o pensamento crítico e a análise ética das informações. Alinhado aos ODS 4 (Educação de qualidade), 10 (Redução das desigualdades) e 16 (Paz, justiça e instituições eficazes).</p>
        <p>
          <b>Equipe:</b>
        </p>
        <ul className="list-disc pl-5">
          <li>Paulo Hernandes Gonçalves da Silva</li>
          <li>Arthur Ferreira de Souza</li>
          <li>Juliana Gomes de Lima</li>
          <li>Maria Luiza Damascena dos Santos</li>
          <li>Thaylon Fernandes de Carvalho</li>
        </ul>
      </>
    ),
  },
  etica: {
    t: "Ética",
    body: (
      <>
        <p>A IA pesquisa evidências na web, separa fatos de opiniões, não inventa fontes e informa quando não consegue verificar algo.</p>
        <p>Suspeitas de interesse político, econômico ou institucional são tratadas como hipóteses, nunca como fatos comprovados. O índice de confiança mede a solidez das evidências, não a probabilidade de a notícia ser verdadeira.</p>
      </>
    ),
  },
  contato: {
    t: "Contato",
    body: (
      <p>Dúvidas, sugestões ou correções sobre o IArgoss? Entre em contato com a equipe do projeto.</p>
    ),
  },
  termos: {
    t: "Termos",
    body: (
      <>
        <p>O IArgoss é uma ferramenta educacional de apoio e pode errar. Confira sempre as fontes listadas antes de tomar decisões ou compartilhar conclusões.</p>
        <p>O texto/link enviado é processado pela API da OpenAI (com pesquisa na web) para gerar a análise. Não armazenamos suas pesquisas nem exigimos cadastro. Há limite de uso por pessoa.</p>
      </>
    ),
  },
};

export default function Verifier() {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const resRef = useRef<HTMLDivElement>(null);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (loading) return;
    setError(null);
    if (q.trim().length < 8) {
      setError("Digite ao menos 8 caracteres, cole um texto ou um link.");
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await fetch("/api/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: q }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error || "O servidor demorou demais ou falhou antes de concluir a análise. Tente novamente.");
      setResult(data);
      setTimeout(() => resRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden">
      <section className="relative flex min-h-screen flex-col">
        <div className="mx-auto flex w-full max-w-[750px] flex-1 flex-col justify-center px-4 pt-10 pb-6">
          <h1 className="mb-9 flex items-center justify-center gap-2 text-[32px] font-extrabold tracking-tight" style={{ color: "var(--ink)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/icone.png" alt="" width={44} height={44} className="h-11 w-11 object-contain" />
            IArgoss
          </h1>

          <form onSubmit={submit} className="card flex items-center gap-2 p-[5px]" style={{ borderRadius: 12, borderColor: "#c9d0da" }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={6000}
              aria-label="Notícia ou link para verificar"
              placeholder="Cole ou pesquise o link da notícia para verificação instantânea..."
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-[16px] outline-none placeholder:text-[#515b68]"
            />
            <button
              type="submit"
              disabled={loading}
              aria-label="Verificar"
              className="flex h-[46px] w-[62px] shrink-0 items-center justify-center rounded-lg text-white transition hover:brightness-95 disabled:opacity-60"
              style={{ background: "var(--blue)" }}
            >
              {loading ? <Loader2 className="spin" size={22} /> : <Search size={22} />}
            </button>
          </form>

          {error && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sm" style={{ color: "#b3321f" }}>
              <AlertTriangle size={16} /> {error}
              <button onClick={() => submit()} className="ml-1 underline">
                Tentar novamente
              </button>
            </p>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CARDS.map(({ icon: Icon, title, lines }) => (
              <div key={title} className="card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Icon size={20} color="var(--blue2)" strokeWidth={2.2} />
                  <h2 className="text-[16px] font-bold">{title}</h2>
                </div>
                <p className="text-[17px] leading-snug" style={{ color: "var(--ink)" }}>
                  {lines.join(" ")}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-9 text-center text-[17px]">Verificação ética e com foco em dados verídicos.</p>
          {loading && <p className="mt-4 text-center text-sm" style={{ color: "var(--ink2)" }}>Analisando informações... isso pode levar até 1 minuto.</p>}
        </div>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/assets/ROBO.png"
          alt="Mascote robô do IArgoss"
          className="pointer-events-none absolute right-2 bottom-2 z-0 hidden h-auto w-[clamp(120px,17vw,290px)] select-none md:block lg:right-6"
        />

        <footer className="relative z-10 pb-6 text-center text-[14px]" style={{ color: "var(--ink2)" }}>
          <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 px-4">
            {Object.entries(INFO).map(([k, v]) => (
              <button key={k} onClick={() => setInfo(k)} className="hover:underline">
                {v.t}
              </button>
            ))}
          </nav>
        </footer>
      </section>

      {result && (
        <section ref={resRef} className="fade-in relative z-10 mx-auto w-full max-w-[880px] px-4 pb-24">
          <ResultPanel r={result} />
        </section>
      )}

      {info && (
        <dialog
          open
          onClick={(e) => e.target === e.currentTarget && setInfo(null)}
          className="fixed inset-0 z-50 m-0 flex h-full w-full items-center justify-center bg-[rgba(23,33,46,0.35)] p-4"
        >
          <div className="card max-h-[85vh] w-full max-w-[520px] overflow-auto p-6">
            <h2 className="mb-3 text-xl font-bold">{INFO[info].t}</h2>
            <div className="space-y-3 text-[15px] leading-relaxed" style={{ color: "var(--ink2)" }}>
              {INFO[info].body}
            </div>
            <button onClick={() => setInfo(null)} className="mt-5 rounded-lg px-4 py-2 text-white" style={{ background: "var(--blue)" }}>
              Fechar
            </button>
          </div>
        </dialog>
      )}
    </main>
  );
}

function ResultPanel({ r }: { r: VerifyResult }) {
  const color = TONE[r.classificacao] ?? "#515b68";
  const sections = [
    { t: "Quem criou?", c: r.quemCriou, i: User },
    { t: "Qual a fonte?", c: r.qualAFonte, i: FileText },
    { t: "Qual o interesse?", c: r.qualOInteresse, i: Scale },
  ];
  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full px-3 py-1 text-sm font-bold text-white" style={{ background: color }}>
            {r.classificacao}
          </span>
          <span className="text-sm" style={{ color: "var(--ink2)" }}>
            {r.confianca === null ? "Confiança não determinada" : `Índice de confiança na conclusão: ${r.confianca}/100`}
          </span>
        </div>
        {r.alegacao && (
          <p className="mt-3 text-sm" style={{ color: "var(--ink2)" }}>
            <b>Alegação analisada:</b> {r.alegacao}
          </p>
        )}
        <h2 className="mt-4 mb-1 text-lg font-bold">Resumo da verificação</h2>
        <p className="leading-relaxed whitespace-pre-line">{r.resumo}</p>
        {r.confianca !== null && (
          <p className="mt-3 text-xs" style={{ color: "var(--ink2)" }}>
            O índice combina qualidade das evidências, fontes independentes, consistência, atualidade e documentos primários. Não é a probabilidade de a notícia ser verdadeira.
          </p>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map(({ t, c, i: Icon }) => (
          <div key={t} className="card p-5">
            <h3 className="mb-2 flex items-center gap-2 font-bold">
              <Icon size={18} color="var(--blue2)" /> {t}
            </h3>
            <p className="text-[15px] leading-relaxed whitespace-pre-line" style={{ color: "var(--ink2)" }}>
              {c}
            </p>
          </div>
        ))}
      </div>

      {r.limitacoes && (
        <div className="card p-5 text-[15px]">
          <b>Limitações:</b> <span style={{ color: "var(--ink2)" }}>{r.limitacoes}</span>
        </div>
      )}

      {r.matriz.length > 0 && (
        <div className="card p-6">
          <h2 className="mb-1 text-lg font-bold">Matriz de evidências</h2>
          <p className="mb-3 text-sm" style={{ color: "var(--ink2)" }}>
            Linhas independentes que apoiam: {r.linhasIndependentes.apoio}
            {r.linhasIndependentes.primariaApoio ? " (com evidência primária)" : ""} · que contradizem: {r.linhasIndependentes.contradicao}. Republicações e fontes com a mesma origem contam como uma só.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ color: "var(--ink2)" }}>
                  <th className="py-1 pr-3">Fonte</th>
                  <th className="py-1 pr-3">Papel</th>
                  <th className="py-1 pr-3">Posição</th>
                  <th className="py-1">Conta como linha?</th>
                </tr>
              </thead>
              <tbody>
                {r.matriz.map((m, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: "var(--line)" }}>
                    <td className="py-1 pr-3">
                      {m.url ? (
                        <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue2)" }}>
                          {m.fonte}
                        </a>
                      ) : (
                        <span title="Não corresponde a uma fonte real da busca">{m.fonte} (não verificada)</span>
                      )}
                    </td>
                    <td className="py-1 pr-3">{m.papel}</td>
                    <td className="py-1 pr-3">{m.posicao}</td>
                    <td className="py-1">{m.contaComoLinha ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="mb-3 text-lg font-bold">Fontes e evidências</h2>
        {r.fontes.length === 0 ? (
          <p style={{ color: "var(--ink2)" }}>A busca não retornou fontes verificáveis para esta análise. Trate a conclusão com cautela.</p>
        ) : (
          <ul className="space-y-3">
            {r.fontes.map((s) => (
              <li key={s.url} className="border-b pb-3 last:border-0" style={{ borderColor: "var(--line)" }}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold break-all" style={{ color: "var(--blue2)" }}>
                  {s.titulo} <ExternalLink size={14} />
                </a>
                <div className="text-sm" style={{ color: "var(--ink2)" }}>
                  {s.dominio}
                  {s.data ? ` · ${s.data}` : ""}
                </div>
                <p className="text-sm">{s.relevancia}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs" style={{ color: "var(--ink2)" }}>
          Verificado em {new Date(r.verificadoEm).toLocaleString("pt-BR")} · modelo {r.modelo} · {r.uso.tokensTotal} tokens, {r.uso.consultasBusca} pesquisa(s) web, custo estimado US$ {r.uso.custoUsd.toFixed(3)}{r.uso.cache ? " (resultado em cache)" : ""}
        </p>
      </div>
    </div>
  );
}
