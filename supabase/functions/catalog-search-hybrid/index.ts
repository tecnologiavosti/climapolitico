// Political Actor Discovery Engine
// Hybrid: TSE oficial (histórico) + descoberta dinâmica de atores políticos via Web + IA.
// SEM listas fixas, SEM seeds, SEM banco pré-populado.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeName } from "../_shared/normalize-name.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import {
  canonicalCargoKey,
  electionYearForCargo,
  shouldUseMunicipio,
} from "../_shared/cargo-map.ts";

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

function normalizeCargo(value?: string | string[] | null): string {
  return canonicalCargoKey(value) ?? normalizeText(value);
}

function normalizeCandidateType(v: Body["candidateType"]): "official" | "pre_candidate" | "both" | "ai" {
  return v === "official" || v === "pre_candidate" || v === "ai" || v === "both" ? v : "both";
}

function sanitizeBody(body: Body): Body {
  const cargo = normalizeCargo(body.cargo);
  const municipio = cargo && !shouldUseMunicipio([cargo]) ? null : (body.municipio?.trim() || null);
  return {
    ...body,
    cargo: cargo ? [cargo] : null,
    municipio,
    candidateType: normalizeCandidateType(body.candidateType),
  };
}

const UF_TO_NAME: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia",
  CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás",
  MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais",
  PA: "Pará", PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí",
  RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo",
  SE: "Sergipe", TO: "Tocantins",
};
function ufFullName(uf?: string | null): string {
  if (!uf) return "";
  return UF_TO_NAME[String(uf).toUpperCase().slice(0, 2)] || String(uf);
}

const UF_BY_NAME: Record<string, string> = {
  "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM", "bahia": "BA",
  "ceara": "CE", "distrito federal": "DF", "espirito santo": "ES", "goias": "GO",
  "maranhao": "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
  "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE", "piaui": "PI",
  "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS",
  "rondonia": "RO", "roraima": "RR", "santa catarina": "SC", "sao paulo": "SP",
  "sergipe": "SE", "tocantins": "TO",
};
function normalizeUf(value: any): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (raw.length === 2) return raw.toUpperCase();
  const key = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return UF_BY_NAME[key] || raw.toUpperCase().slice(0, 2);
}

// ---------- QUERY GENERATION (dynamic, no hardcoded lists) ----------
function buildDiscoveryQueries(cargo: string, uf: string, mun: string): string[] {
  const estadoNome = ufFullName(uf);
  if (cargo === "vereador" && mun) {
    return [
      `${mun} política`,
      `${mun} câmara municipal`,
      `${mun} vereador`,
      `${mun} liderança comunitária`,
      `${mun} associação de bairro`,
      `${mun} eleições 2026`,
      `${mun} pré-candidato vereador`,
      `${mun} ${uf} política local`,
    ];
  }
  if (cargo === "prefeito" && mun) {
    return [
      `${mun} prefeito`,
      `${mun} oposição prefeitura`,
      `${mun} política municipal`,
      `${mun} empresário política`,
      `${mun} pré-candidato prefeito 2026`,
      `${mun} ${uf} eleições municipais`,
      `${mun} vereador cotado prefeitura`,
      `${mun} sindicalista política`,
    ];
  }
  if (cargo === "governador" && estadoNome) {
    return [
      `política ${estadoNome}`,
      `eleição governador ${estadoNome} 2026`,
      `sucessão governo ${estadoNome}`,
      `pré-candidato governador ${estadoNome}`,
      `oposição ${estadoNome}`,
      `governador ${estadoNome} pesquisa eleitoral`,
      `senadores ${estadoNome} governo 2026`,
      `${estadoNome} articulação política 2026`,
    ];
  }
  if (cargo === "senador" && estadoNome) {
    return [
      `${estadoNome} senador 2026`,
      `${estadoNome} pré-candidato senado`,
      `${estadoNome} política senado`,
    ];
  }
  if ((cargo === "deputado_federal" || cargo === "deputado_estadual" || cargo === "deputado_distrital") && estadoNome) {
    const label = cargo.replace(/_/g, " ");
    return [
      `${estadoNome} ${label} 2026`,
      `${estadoNome} pré-candidato ${label}`,
      `${estadoNome} política ${label}`,
    ];
  }
  if (cargo === "presidente") {
    return [
      `"pré-candidato à presidência" 2026`,
      `"cotado para 2026" presidência`,
      `"disputa o Planalto" 2026`,
      `"sucessão presidencial" 2026`,
      `presidenciáveis 2026 site:folha.uol.com.br OR site:oglobo.globo.com OR site:estadao.com.br`,
      `presidenciáveis 2026 site:cnnbrasil.com.br OR site:poder360.com.br OR site:uol.com.br OR site:g1.globo.com`,
      `pré-candidatos presidência república 2026`,
      `eleição presidencial brasil 2026 favoritos`,
    ];
  }
  // fallback
  const local = mun || estadoNome || "brasil";
  return [`${cargo} ${local} 2026`, `política ${local} 2026`];
}

// ---------- WEB SEARCH ----------
interface WebHit { title?: string; description?: string; url?: string }

async function firecrawlSearch(query: string): Promise<WebHit[]> {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 10, lang: "pt", country: "br", tbs: "qdr:y" }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.warn("[discovery] firecrawl status", r.status, String(j?.error ?? j?.message ?? "").slice(0, 180));
      return [];
    }
    const items = Array.isArray(j?.data) ? j.data
      : Array.isArray(j?.data?.web) ? j.data.web
      : Array.isArray(j?.web) ? j.web
      : Array.isArray(j?.results) ? j.results : [];
    return items.slice(0, 10).map((it: any) => ({
      title: it?.title,
      description: it?.description ?? it?.snippet ?? it?.markdown?.slice?.(0, 700),
      url: it?.url,
    }));
  } catch (e) { console.warn("[discovery] firecrawl err", e); return []; }
}

// ---------- AI SCORING ----------
interface DiscoveredCandidate {
  nome: string;
  partido?: string | null;
  cargo?: string | null;
  estado?: string | null;
  municipio?: string | null;
  confidence: number;
  status?: string;
  reason?: string;
}

async function scorePoliticalActors(
  body: Body, hits: WebHit[], queries: string[],
): Promise<DiscoveredCandidate[]> {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const estadoNome = ufFullName(uf);
  const mun = body.municipio || "";

  const evidence = hits.length
    ? hits.slice(0, 25).map((h, i) =>
        `[${i + 1}] ${h.title ?? ""}\n${h.description ?? ""}\n${h.url ?? ""}`
      ).join("\n---\n").slice(0, 9000)
    : `(sem resultados web disponíveis; use seu conhecimento de figuras políticas brasileiras notórias para o cargo/estado). Queries tentadas: ${queries.join(" | ")}`;

  const local = mun ? `${mun}/${uf}` : estadoNome ? `${estadoNome}` : "Brasil";
  const isStateOrNational = !mun && (cargo === "governador" || cargo === "senador" ||
    cargo === "deputado_federal" || cargo === "deputado_estadual" || cargo === "deputado_distrital" ||
    cargo === "presidente");

  const system = `Você é um analista político brasileiro sênior. Responda SEMPRE em JSON estrito. Use SEMPRE nomes reais e verificáveis de POLÍTICOS brasileiros (nunca jornalistas, comentaristas, influenciadores, apresentadores, celebridades ou empresários sem campanha ativa).`;

  const isPresidente = cargo === "presidente";

  const presidenteRules = isPresidente ? `
REGRAS ESTRITAS PARA PRESIDENTE (aplicar TODAS):
1. A pessoa PRECISA ocupar/ter ocupado cargo político relevante: presidente, ex-presidente, governador, ex-governador, senador, ministro, deputado federal de destaque nacional, ou prefeito de capital.
2. PRECISA haver evidência textual eleitoral explícita nas fontes (ex.: "pré-candidato à presidência", "cotado para 2026", "disputa o Planalto", "sucessão presidencial", "nome para 2026").
3. Fontes confiáveis obrigatórias (Folha, O Globo, Estadão, CNN Brasil, Poder360, UOL Política, G1). Redes sociais sozinhas NÃO bastam.
4. HARD-BLOCK: jornalistas (Andréia Sadi, William Waack, etc.), comentaristas, apresentadores, influenciadores, celebridades e empresários sem campanha eleitoral ativa. NÃO incluir.
5. NÃO forçar estado. Infira o estado REAL de origem/atuação política de cada nome (ex.: Lula-SP, Tarcísio-SP, Ratinho Jr-PR, Caiado-GO, Eduardo Leite-RS, Ronaldo Nogueira-RS, Ciro-CE, Marina-AC, Zema-MG, Haddad-SP, Pacheco-MG, Simone Tebet-MS).
6. Score = 40% relevância política + 40% evidência eleitoral (menções explícitas de 2026/Planalto) + 20% força de mídia (fontes confiáveis).
7. Só retorne quem cumprir ao menos 3 dos 4 critérios (cargo, evidência textual, fonte confiável, menção 2026).
` : "";

  const user = `Identifique pré-candidatos ao cargo de "${cargo || "político"}" em ${local} nas eleições de 2026.

${presidenteRules}

${isStateOrNational && !isPresidente
  ? `Cargo estadual/nacional: use seu conhecimento sobre a política brasileira (governadores, ex-governadores, senadores, deputados, prefeitos de capitais, líderes partidários). Evidências são complemento.`
  : isPresidente
    ? `Baseie-se nas evidências web fornecidas. Só inclua nomes que apareçam nas evidências com contexto eleitoral 2026 EXPLÍCITO.`
    : `Baseie-se prioritariamente nas evidências. Use apenas nomes REAIS presentes nelas.`}

Classificação:
- forte     (score 90-100)
- cotado    (score 75-89)
- possivel  (score 60-74)
- emergente (score 40-59, apenas cargos locais)

${isPresidente ? "Para PRESIDENTE, só retorne com score >= 60. Máximo 15 nomes." : "Retorne 5 a 30 nomes."} Infira partido e ESTADO real de cada pessoa. "reason" curto citando a fonte/evidência.

Cargo filtrado: ${cargo || "qualquer"}
Estado filtro: ${estadoNome} (${uf || "-"})
Município: ${mun || "-"}

Evidências:
${evidence}

JSON estrito:
{ "candidatos": [
  { "name": string, "score": number, "status": "forte"|"cotado"|"possivel"|"emergente",
    "party": string|null, "role": string|null, "state": string|null, "category": "politico"|"jornalista"|"influenciador"|"empresario"|"celebridade"|"outro", "reason": string }
] }`;

  try {
    const ai = await callAICerebrasFirst({
      systemMsg: system, userPrompt: user, jsonMode: true,
      maxTokens: 2200, temperature: 0.2, tag: "discovery-engine",
    });
    const parsed = JSON.parse(ai.content);
    const arr = Array.isArray(parsed?.candidatos) ? parsed.candidatos : [];
    const BLOCKED_CATEGORIES = new Set(["jornalista", "comentarista", "influenciador", "apresentador", "celebridade", "empresario"]);
    return arr
      .filter((c: any) => c?.name && typeof c.score === "number")
      .filter((c: any) => {
        const cat = String(c.category || "").toLowerCase();
        if (BLOCKED_CATEGORIES.has(cat)) {
          console.log("[discovery] BLOCKED category:", c.name, cat);
          return false;
        }
        return true;
      })
      .map((c: any): DiscoveredCandidate => ({
        nome: String(c.name).trim(),
        partido: c.party || null,
        cargo: c.role || cargo || null,
        estado: (c.state ? normalizeUf(c.state) : null) || (isPresidente ? null : (uf || null)),
        municipio: mun || null,
        confidence: Math.max(0, Math.min(100, Number(c.score) || 0)),
        status: c.status || "emergente",
        reason: c.reason ? String(c.reason).slice(0, 300) : "",
      }));
  } catch (e) { console.warn("[discovery] ai err", e); return []; }
}

// ---------- OUTPUT ----------
type Tier = "forte" | "possivel" | "fraco" | "inelegivel";

const INELIGIBLE: Record<string, { until: string; reason: string }> = {
  "jair bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
  "jair messias bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
};

function tierFromScore(score: number): Tier {
  if (score >= 90) return "forte";
  if (score >= 60) return "possivel";
  return "fraco";
}

function toRow(c: DiscoveredCandidate, fallbackCargo: string) {
  const cargo = canonicalCargoKey(c.cargo) ?? canonicalCargoKey(fallbackCargo) ?? null;
  const inel = INELIGIBLE[normalizeName(c.nome)];
  const tier: Tier = inel ? "inelegivel" : tierFromScore(c.confidence);
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
    candidate_type: "pre_candidate" as const,
    confidence_score: c.confidence,
    confidence_tier: tier,
    is_eligible: !inel,
    ineligible_reason: inel?.reason ?? null,
    reason: c.reason || null,
  };
}

// ---------- DISCOVERY ENGINE ----------
async function discoverPoliticalActors(body: Body): Promise<any[]> {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();

  console.log("DISCOVERY MODE");
  console.log("FILTER:", { cargo, uf, mun });

  const queries = buildDiscoveryQueries(cargo, uf, mun);
  console.log("SEARCH QUERIES:", queries);

  console.log("STEP 1 FILTERS", { cargo, uf, mun });
  console.log("STEP 2 QUERIES", queries);

  if (!queries.length) { console.log("FINAL IA RESULTS: 0 (no queries)"); return []; }

  const hitLists = FIRECRAWL_API_KEY
    ? await Promise.all(queries.map(firecrawlSearch))
    : [];
  const seen = new Set<string>();
  const hits: WebHit[] = [];
  for (const list of hitLists) for (const h of list) {
    const k = h.url || `${h.title}|${h.description}`;
    if (k && !seen.has(k)) { seen.add(k); hits.push(h); }
  }
  console.log("STEP 3 RAW SEARCH", hits.length);

  // NÃO abortar aqui: para cargos estaduais/nacionais, a IA usa conhecimento próprio como fallback.
  const discovered = await scorePoliticalActors(body, hits, queries);
  console.log("STEP 4 EXTRACTED NAMES", discovered.length);
  console.log("STEP 5 LLM OUTPUT", discovered.map((c) => `${c.nome} (${c.confidence})`).join(" | "));

  // Dedup: chave = últimos 2 tokens do nome normalizado (une "Felipe D'Avila" e "Luiz Felipe D'Avila")
  const dedupKeyOf = (nome: string) => {
    const toks = normalizeName(nome).split(/\s+/).filter(Boolean);
    return toks.length >= 2 ? toks.slice(-2).join(" ") : toks.join(" ");
  };
  const dedup = new Map<string, DiscoveredCandidate>();
  for (const c of discovered) {
    const key = dedupKeyOf(c.nome);
    if (!key) continue;
    const prev = dedup.get(key);
    if (!prev || c.confidence > prev.confidence) dedup.set(key, c);
  }

  const isPresidente = cargo === "presidente";
  const minScore = isPresidente ? 60 : 40;
  const rows = Array.from(dedup.values())
    .filter((c) => c.confidence >= minScore && (c.nome || "").trim().split(/\s+/).length >= 2)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, isPresidente ? 15 : 50)
    .map((c) => toRow(c, cargo));

  console.log("STEP 6 FINAL FILTER", rows.length);
  return rows;
}

// ---------- TSE PROXY (histórico oficial) ----------
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
    const rawBody = (await req.json()) as Body;
    const body = sanitizeBody(rawBody);
    const candidateType = normalizeCandidateType(body.candidateType);
    const authHeader = req.headers.get("Authorization");
    const page = body.page ?? 0;

    const cargo = normalizeCargo(body.cargo);
    const electionYear = cargo ? electionYearForCargo(cargo) : null;
    console.log("RAW FILTERS", rawBody);
    console.log("NORMALIZED CARGO", cargo, "YEAR", electionYear, "TYPE", candidateType);

    const wantsTSE = candidateType === "official" || candidateType === "both";
    const wantsAI = candidateType === "pre_candidate" || candidateType === "ai" || candidateType === "both";

    // Modo IA puro: só descoberta, NUNCA cai em TSE.
    if (candidateType === "pre_candidate" || candidateType === "ai") {
      const aiRows = await discoverPoliticalActors(body);
      const total = aiRows.length;
      const start = page * PAGE_SIZE;
      const paged = aiRows.slice(start, start + PAGE_SIZE);
      const message = aiRows.length === 0
        ? "Não encontramos sinais políticos suficientes na web para esse filtro."
        : null;

      return new Response(JSON.stringify({
        rows: paged,
        total,
        hasMore: start + PAGE_SIZE < total,
        exactTotal: true,
        suggestions: [],
        normalized: {},
        message,
        fallback: aiRows.length > 0,
        page,
        last_updated: new Date().toISOString(),
        nationalOnly: false,
        partial: false,
        sources: aiRows.length ? ["ai_web"] : [],
        counts: { official: 0, pre_candidate: aiRows.length, ai: aiRows.length },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Modo both/official
    const [tse, aiRows] = await Promise.all([
      wantsTSE ? callTSE(body, authHeader) : Promise.resolve({ rows: [], total: 0, hasMore: false, sources: [] }),
      wantsAI ? discoverPoliticalActors(body) : Promise.resolve([] as any[]),
    ]);

    const tseRows = (tse.rows ?? []).map((r: any) => ({
      ...r,
      candidate_type: "official" as const,
      confidence_score: r.eleito ? 100 : 85,
    }));

    console.log("[hybrid] TSE:", tseRows.length, "AI:", aiRows.length);

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
      counts: { official: tseRows.length, pre_candidate: aiRows.length, ai: aiRows.length },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[catalog-search-hybrid]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
