// Busca híbrida: TSE oficial + descoberta dinâmica de pré-candidatos via IA + Web.
// SEM banco pré-populado. Pré-candidatos descobertos em tempo real via Firecrawl + LLM.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeName } from "../_shared/normalize-name.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

interface Body {
  q?: string | null;
  cargo?: string | string[] | null;
  partido?: string | string[] | null;
  regiao?: string | string[] | null;
  estado?: string | string[] | null;
  municipio?: string | null;
  onlyEleitos?: boolean;
  page?: number;
  candidateType?: "official" | "pre_candidate" | "both" | "ai";
}

const PAGE_SIZE = 50;

function firstValue(value?: string | string[] | null): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

function normalizeText(value?: string | string[] | null): string {
  return firstValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function buildCargoQueries(cargo: string, estado?: string, municipio?: string): string[] {
  switch (cargo) {
    case "presidente":
      return [
        "pré-candidatos presidente brasil 2026",
        "candidatos presidência da república 2026",
      ];
    case "governador":
      return [
        `pré-candidato governador ${estado || "brasil"} 2026`,
        `candidatos governo ${estado || ""} 2026`,
      ];
    case "prefeito":
      return [
        `pré-candidatos prefeito ${municipio || ""} ${estado || ""}`,
        `eleições prefeitura ${municipio || ""} ${estado || ""} 2026`,
      ];
    case "vereador":
      return [
        `vereadores em ascensão ${municipio || ""} ${estado || ""}`,
        `pré-candidatos vereador ${municipio || ""} ${estado || ""}`,
        `câmara municipal ${municipio || ""} ${estado || ""}`,
      ];
    case "senador":
      return [
        `pré-candidato senador ${estado || "brasil"} 2026`,
        `senado ${estado || ""} 2026 candidatos`,
      ];
    case "deputado federal":
      return [`pré-candidatos deputado federal ${estado || "brasil"} 2026`];
    case "deputado estadual":
      return [`pré-candidatos deputado estadual ${estado || "brasil"} 2026`];
    default:
      return cargo ? [`pré-candidato ${cargo} ${municipio || ""} ${estado || ""} 2026`] : [];
  }
}

function buildQueries(body: Body): string[] {
  const qs: string[] = [];
  const q = (body.q || "").trim();
  const cargo = normalizeText(body.cargo);
  const uf = firstValue(body.estado).toUpperCase() || undefined;
  const mun = body.municipio?.trim() || undefined;

  if (q) {
    qs.push(`${q} política eleições 2026 brasil${uf ? " " + uf : ""}${mun ? " " + mun : ""}`);
  }
  if (cargo) {
    qs.push(...buildCargoQueries(cargo, uf, mun));
  }
  if (!qs.length && (uf || mun)) {
    qs.push(`pré-candidatos ${mun ?? uf} 2026`);
  }
  return Array.from(new Set(qs.map((query) => query.replace(/\s+/g, " ").trim()).filter(Boolean))).slice(0, 3);
}

interface WebHit { title?: string; description?: string; url?: string }

async function firecrawlSearch(query: string): Promise<WebHit[]> {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 8, lang: "pt", country: "br", tbs: "qdr:m" }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.warn("[hybrid] firecrawl status", r.status, String(j?.error ?? j?.message ?? "").slice(0, 180));
      return [];
    }
    const items = Array.isArray(j?.data)
      ? j.data
      : Array.isArray(j?.data?.web)
        ? j.data.web
        : Array.isArray(j?.web)
          ? j.web
          : Array.isArray(j?.results)
            ? j.results
            : [];
    console.log("[hybrid] firecrawl query hits:", query, items.length);
    return items.slice(0, 8).map((it: any) => ({
      title: it?.title,
      description: it?.description ?? it?.snippet ?? it?.markdown?.slice?.(0, 700),
      url: it?.url,
    }));
  } catch (e) { console.warn("[hybrid] firecrawl err", e); return []; }
}

interface ExtractedCandidate {
  nome: string;
  partido?: string | null;
  cargo?: string | null;
  estado?: string | null;
  municipio?: string | null;
  confidence: number;
  reason?: string;
  recent_evidence?: boolean;
  poll_evidence?: boolean;
  only_historical?: boolean;
  last_mention_months?: number | null;
}

async function extractCandidatesFromWeb(
  body: Body, hits: WebHit[], queries: string[],
): Promise<ExtractedCandidate[]> {
  const cargo = normalizeText(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = body.municipio || "";
  const evidence = hits.length
    ? hits.slice(0, 12).map((h, i) =>
      `[${i + 1}] ${h.title ?? ""}\n${h.description ?? ""}\n${h.url ?? ""}`
    ).join("\n---\n").slice(0, 6000)
    : `Sem resultados web disponíveis neste momento. Consultas geradas: ${queries.join(" | ")}`;

  const system = `Você é um analista político brasileiro. Extraia pré-candidatos a cargos eletivos no Brasil para 2026 a partir de evidências da web. Responda SEMPRE em JSON estrito.`;
  const user = `Filtros do usuário:
- Cargo: ${cargo || "qualquer"}
- Estado (UF): ${uf || "qualquer"}
- Município: ${mun || "qualquer"}
- Nome buscado: ${body.q || "—"}
Data atual: ${new Date().toISOString().slice(0, 10)}

Evidências (resultados de busca recente):
${evidence}

Para cada PESSOA REAL, BRASILEIRA, com sinais EXPLÍCITOS de pré-candidatura ao CARGO filtrado, retorne um item.
REGRAS DE CARGO (estritas):
- Se o cargo filtrado for "governador", inclua APENAS pré-candidatos ao governo do estado filtrado. NÃO inclua presidentes, senadores, deputados, prefeitos ou vereadores — a menos que haja evidência textual clara de troca para a disputa de governador (ex.: "pré-candidato ao governo de ${uf || "[UF]"}").
- Se o cargo for "presidente", apenas pré-candidatos à presidência da República.
- Se o cargo for "senador", "deputado federal" ou "deputado estadual", apenas para o estado filtrado.
- Se o cargo for "prefeito" ou "vereador", apenas para o município filtrado.
- O campo "cargo" do item DEVE bater com o cargo filtrado quando houver filtro.
- Inclua no "reason" a evidência textual curta com data/ano (ex.: "anunciou pré-candidatura ao governo de SP em out/2025").
- Marque "recent_evidence": true SOMENTE se houver notícia EXPLÍCITA dos últimos 180 dias mencionando candidatura ao cargo filtrado (frases como "pré-candidato a", "vai disputar", "lançou pré-candidatura", "campanha ao").
- Marque "poll_evidence": true se a pessoa aparece em pesquisa eleitoral recente (Datafolha, Quaest, Genial/Quaest, AtlasIntel, Paraná Pesquisas) para o cargo filtrado.
- Marque "only_historical": true se a pessoa só tem relevância histórica/passada e não há sinal recente de candidatura.
- "last_mention_months": número aproximado de meses desde a menção mais recente relevante (ou null).
NÃO inclua nomes apenas "politicamente relevantes" sem evidência de candidatura ao cargo filtrado.
Se as evidências web estiverem indisponíveis, retorne somente figuras com pré-candidatura PÚBLICA NOTÓRIA e confirmada ao cargo/região; não invente.
NÃO invente nomes desconhecidos. Máximo 12 itens, ordenados por confiança desc.

JSON estrito:
{ "candidatos": [
  { "nome": string, "partido": string|null, "cargo": string|null,
    "estado": string|null, "municipio": string|null,
    "confidence": number, "reason": string,
    "recent_evidence": boolean, "poll_evidence": boolean,
    "only_historical": boolean, "last_mention_months": number|null }
] }`;

  try {
    const ai = await callAICerebrasFirst({
      systemMsg: system, userPrompt: user, jsonMode: true,
      maxTokens: 1400, temperature: 0.2, tag: hits.length ? "catalog-discover" : "catalog-discover-ai-fallback",
    });
    const parsed = JSON.parse(ai.content);
    const arr = Array.isArray(parsed?.candidatos) ? parsed.candidatos : [];
    return arr
      .filter((c: any) => c?.nome && typeof c.confidence === "number")
      .map((c: any) => ({
        nome: String(c.nome).trim(),
        partido: c.partido || null,
        cargo: c.cargo || null,
        estado: c.estado || null,
        municipio: c.municipio || null,
        confidence: Math.max(0, Math.min(100, Number(c.confidence) || 0)),
        reason: c.reason ? String(c.reason).slice(0, 280) : "",
        recent_evidence: !!c.recent_evidence,
        poll_evidence: !!c.poll_evidence,
        only_historical: !!c.only_historical,
        last_mention_months: typeof c.last_mention_months === "number" ? c.last_mention_months : null,
      }));
  } catch (e) { console.warn("[hybrid] extract err", e); return []; }
}


function toRow(c: ExtractedCandidate, fallbackCargo: string, scored: { score: number; tier: "confirmed" | "speculative" }) {
  const cargo = (c.cargo || fallbackCargo || "").toLowerCase().replace(/\s+/g, "_") || null;
  return {
    id: `ai:${normalizeName(c.nome)}:${(c.estado || "").toUpperCase()}:${(c.municipio || "").toLowerCase()}`,
    tse_id: null,
    nome: c.nome,
    nome_urna: null,
    partido_sigla: c.partido,
    partido_nome: null,
    numero_partido: null,
    cargo,
    regiao: null,
    estado: c.estado,
    municipio: c.municipio,
    eleito: false,
    categoria: "pre_candidato" as const,
    ano_eleicao: 2026,
    foto_url: null,
    redes_sociais: {},
    popularidade: 0,
    similarity: 0.7,
    total_count: 0,
    candidate_type: "pre_candidate",
    confidence_score: scored.score,
    confidence_tier: scored.tier,
    reason: c.reason || null,
  };
}


// Cargos mutuamente exclusivos: se o cargo atual da pessoa é X, NÃO serve para Y (a menos que haja evidência explícita).
const CARGO_INCOMPATIBLE: Record<string, string[]> = {
  governador: ["presidente", "senador", "deputado federal", "deputado estadual", "prefeito", "vereador", "ministro"],
  presidente: ["governador", "senador", "deputado federal", "deputado estadual", "prefeito", "vereador"],
  senador: ["presidente", "vereador", "prefeito"],
  prefeito: ["presidente", "governador", "senador", "vereador"],
  vereador: ["presidente", "governador", "senador", "deputado federal"],
};

function evidenceOfCandidacy(reason: string, filterCargo: string, uf: string, mun: string): boolean {
  const r = (reason || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!filterCargo) return false;
  const cargoTokens: Record<string, string[]> = {
    governador: ["governo", "governador"],
    presidente: ["presidencia", "presidente da republica"],
    senador: ["senado", "senador"],
    "deputado federal": ["deputado federal", "camara"],
    "deputado estadual": ["deputado estadual", "assembleia"],
    prefeito: ["prefeito", "prefeitura"],
    vereador: ["vereador", "camara municipal"],
  };
  const tokens = cargoTokens[filterCargo] || [filterCargo];
  const hasCargo = tokens.some((t) => r.includes(t));
  const hasRegion = uf ? r.includes(uf.toLowerCase()) : true;
  const hasMun = mun ? r.includes(mun.toLowerCase()) : true;
  return hasCargo && hasRegion && (mun ? hasMun : true);
}

function scoreRelevance(c: ExtractedCandidate, filterCargo: string, uf: string, mun: string): { score: number; keep: boolean; why: string } {
  // Sem filtro de cargo: não aplica regras estritas.
  if (!filterCargo) return { score: 100, keep: true, why: "sem filtro de cargo" };
  const cCargo = (c.cargo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const cUf = (c.estado || "").toUpperCase();
  const cMun = (c.municipio || "").toLowerCase();
  const hasEvidence = evidenceOfCandidacy(c.reason || "", filterCargo, uf, mun);

  const cargoMatch = cCargo === filterCargo || cCargo.includes(filterCargo);
  const incompatList = CARGO_INCOMPATIBLE[filterCargo] || [];
  const isIncompat = incompatList.some((x) => cCargo === x || cCargo.startsWith(x));

  // Cargo incompatível sem evidência explícita de troca → descartar.
  if (isIncompat && !hasEvidence) {
    return { score: 0, keep: false, why: `cargo incompatível: ${cCargo} vs ${filterCargo}` };
  }

  let score = 0;
  if (cargoMatch || hasEvidence) score += 50;
  // Estado: presidente não exige UF.
  if (filterCargo === "presidente") score += 30;
  else if (uf && (cUf === uf || hasEvidence)) score += 30;
  else if (!uf) score += 30;
  // Município (quando aplicável)
  if (mun) {
    if (cMun && cMun === mun.toLowerCase()) score += 20;
    else if (hasEvidence) score += 10;
  } else {
    score += 20; // evidência genérica de candidatura recente
  }

  return { score, keep: score >= 70, why: `score=${score} cargo=${cCargo} uf=${cUf}` };
}

async function discoverPreCandidates(body: Body): Promise<any[]> {
  const queries = buildQueries(body);
  console.log("PRE-CANDIDATE MODE");
  console.log("AI QUERY:", queries);
  if (!queries.length) { console.log("AI RESULTS:", 0); return []; }
  if (!FIRECRAWL_API_KEY) console.warn("[hybrid] FIRECRAWL_API_KEY missing — using AI-only fallback");

  const hitLists = FIRECRAWL_API_KEY ? await Promise.all(queries.map(firecrawlSearch)) : [];
  const seen = new Set<string>();
  const hits: WebHit[] = [];
  for (const list of hitLists) for (const h of list) {
    const k = h.url || `${h.title}|${h.description}`;
    if (k && !seen.has(k)) { seen.add(k); hits.push(h); }
  }
  console.log("[hybrid] web hits:", hits.length);

  const extracted = await extractCandidatesFromWeb(body, hits, queries);
  console.log("AI RESULTS (raw):", extracted.length);

  // Pós-processamento estrito por cargo/estado/município.
  const filterCargo = normalizeText(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();
  const filtered = extracted.filter((c) => {
    const r = scoreRelevance(c, filterCargo, uf, mun);
    if (!r.keep) console.log("[hybrid] descartado:", c.nome, "—", r.why);
    return r.keep;
  });
  console.log("AI RESULTS (filtrados):", filtered.length);
  return filtered.map((c) => toRow(c, filterCargo));
}

async function callTSE(payload: Body, authHeader: string | null) {
  const url = `${SUPABASE_URL}/functions/v1/tse-search`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader || `Bearer ${ANON_KEY}` },
    body: JSON.stringify(payload),
  });
  if (!r.ok) { console.warn("[hybrid] tse-search failed", r.status); return { rows: [], total: 0, hasMore: false, sources: [] as string[] }; }
  return await r.json();
}

function dedupeKey(row: any) {
  return [
    normalizeName(row.nome || ""),
    (row.estado || "").toUpperCase(),
    (row.municipio || "").toLowerCase(),
    (row.cargo || "").toLowerCase(),
  ].join("|");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json()) as Body;
    const candidateType = body.candidateType || "both";
    const authHeader = req.headers.get("Authorization");
    const page = body.page ?? 0;

    console.log("RAW FILTERS:", body);
    console.log("RAW CARGO:", body.cargo);

    const wantsTSE = candidateType === "official" || candidateType === "both";
    const wantsAI = candidateType === "pre_candidate" || candidateType === "ai" || candidateType === "both";

    console.log("[hybrid] CATALOG MODE:", candidateType, "wantsTSE:", wantsTSE, "wantsAI:", wantsAI);

    if (candidateType === "pre_candidate" || candidateType === "ai") {
      const aiRows = await discoverPreCandidates(body);
      const total = aiRows.length;
      const start = page * PAGE_SIZE;
      const paged = aiRows.slice(start, start + PAGE_SIZE);
      console.log("[hybrid] TSE COUNT:", 0);
      console.log("[hybrid] AI COUNT:", aiRows.length);
      console.log("[hybrid] FINAL COUNT:", total);

      return new Response(JSON.stringify({
        rows: paged,
        total,
        hasMore: start + PAGE_SIZE < total,
        exactTotal: true,
        suggestions: [],
        normalized: {},
        message: null,
        fallback: aiRows.length > 0,
        page,
        last_updated: new Date().toISOString(),
        nationalOnly: false,
        partial: false,
        sources: aiRows.length ? ["ai_web"] : [],
        counts: {
          official: 0,
          pre_candidate: aiRows.filter((row) => row.candidate_type === "pre_candidate").length,
          ai: aiRows.length,
        },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [tse, aiRows] = await Promise.all([
      wantsTSE ? callTSE(body, authHeader) : Promise.resolve({ rows: [], total: 0, hasMore: false, sources: [] }),
      wantsAI ? discoverPreCandidates(body) : Promise.resolve([] as any[]),
    ]);

    const tseRows = (tse.rows ?? []).map((r: any) => ({
      ...r,
      candidate_type: "official" as const,
      confidence_score: r.eleito ? 100 : 85,
    }));

    console.log("[hybrid] TSE COUNT:", tseRows.length);
    console.log("[hybrid] AI COUNT:", aiRows.length);

    const map = new Map<string, any>();
    for (const r of tseRows) map.set(dedupeKey(r), r);
    for (const r of aiRows) {
      const k = dedupeKey(r);
      if (!map.has(k)) map.set(k, r);
    }

    const merged = Array.from(map.values()).sort((a, b) => {
      const ae = a.eleito ? 1 : 0, be = b.eleito ? 1 : 0;
      if (ae !== be) return be - ae;
      const at = a.candidate_type === "official" ? 1 : 0;
      const bt = b.candidate_type === "official" ? 1 : 0;
      if (at !== bt) return bt - at;
      return (b.confidence_score || 0) - (a.confidence_score || 0);
    });

    const total = merged.length;
    const start = page * PAGE_SIZE;
    const paged = merged.slice(start, start + PAGE_SIZE);
    const sources = [
      ...(tse.sources ?? []),
      ...(aiRows.length ? ["ai_web"] : []),
    ];

    console.log("[hybrid] FINAL COUNT:", merged.length);

    return new Response(JSON.stringify({
      rows: paged,
      total,
      hasMore: start + PAGE_SIZE < total,
      exactTotal: true,
      suggestions: tse.suggestions ?? [],
      normalized: tse.normalized ?? {},
      message: tse.message ?? tse.notice ?? null,
      fallback: !!tse.fallback || aiRows.length > 0,
      page,
      last_updated: tse.last_updated ?? new Date().toISOString(),
      nationalOnly: !!tse.nationalOnly,
      partial: !!tse.partial,
      sources,
      counts: {
        official: tseRows.length,
        pre_candidate: 0,
        ai: aiRows.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[catalog-search-hybrid]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
