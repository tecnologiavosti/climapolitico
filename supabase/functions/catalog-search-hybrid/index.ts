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

Para cada PESSOA REAL, BRASILEIRA, retorne nomes COTADOS/VENTILADOS como pré-candidatos ao CARGO filtrado em 2026 — INCLUINDO bastidores, articulação partidária e cotações na imprensa. NÃO exija anúncio oficial: nomes "cotados", "ventilados", "em articulação", "que podem disputar" SÃO válidos.
REGRAS DE CARGO:
- Se o cargo filtrado for "governador" e UF="${uf || "[UF]"}", inclua APENAS nomes cotados ao governo de ${uf || "[UF]"} (mesmo sem anúncio). Use "estado": "${uf || "[UF]"}" (sigla UF, 2 letras).
- Se o cargo for "presidente", apenas cotados à presidência da República.
- Se o cargo for "senador", "deputado federal" ou "deputado estadual", apenas para o estado filtrado (campo "estado" em sigla UF).
- Se o cargo for "prefeito" ou "vereador", apenas para o município filtrado.
- O campo "cargo" do item DEVE bater com o cargo filtrado.
- O campo "estado" SEMPRE em sigla de 2 letras (SP, RJ, MG…), nunca o nome por extenso.
- Inclua no "reason" evidência curta (ex.: "cotado pelo PT para governo de SP em 2026", "Datafolha dez/2025 mostra X em 2º lugar").
- Marque "recent_evidence": true se houver menção (mesmo de bastidor) nos últimos 180 dias ao cargo filtrado.
- Marque "poll_evidence": true se aparece em pesquisa eleitoral recente (Datafolha, Quaest, AtlasIntel, Paraná Pesquisas) para o cargo.
- Marque "only_historical": true se a pessoa só tem relevância passada e nenhum sinal recente de candidatura ao cargo.
- "last_mention_months": meses desde a menção mais recente relevante (ou null).
NÃO invente nomes desconhecidos. Sem evidência web, use APENAS figuras notórias da política brasileira atual cotadas para o cargo/região. Máximo 12 itens, ordenados por confiança desc.

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
        estado: normalizeUf(c.estado),
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

// Mapa nome-de-estado → sigla UF (a IA às vezes devolve "São Paulo" em vez de "SP").
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


// Inelegíveis conhecidos (TSE / decisões judiciais públicas).
const INELIGIBLE: Record<string, { until: string; reason: string }> = {
  "jair bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
  "jair messias bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
};

function lookupIneligible(nome: string) {
  const k = normalizeName(nome);
  return INELIGIBLE[k] || null;
}

type Tier = "forte" | "possivel" | "fraco" | "inelegivel";

function toRow(
  c: ExtractedCandidate,
  fallbackCargo: string,
  scored: { score: number; tier: Tier; eligible: boolean; ineligibleReason: string | null },
) {
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
    is_eligible: scored.eligible,
    ineligible_reason: scored.ineligibleReason,
    reason: c.reason || null,
  };
}

// Cargos mutuamente exclusivos.
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

function scoreRelevance(
  c: ExtractedCandidate,
  filterCargo: string,
  uf: string,
  mun: string,
): { score: number; keep: boolean; tier: Tier; eligible: boolean; ineligibleReason: string | null; why: string } {
  const cCargo = (c.cargo || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  const cUf = (c.estado || "").toUpperCase();

  // Desambiguação: exige nome completo (≥ 2 partes ≥ 2 chars). Single-token ⇒ descarta.
  const parts = (c.nome || "").trim().split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length < 2) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: "nome incompleto (single token)" };
  }

  const hasEvidence = filterCargo ? evidenceOfCandidacy(c.reason || "", filterCargo, uf, mun) : false;
  const cargoMatch = filterCargo ? (cCargo === filterCargo || cCargo.includes(filterCargo)) : true;
  const incompatList = filterCargo ? (CARGO_INCOMPATIBLE[filterCargo] || []) : [];
  const isIncompat = incompatList.some((x) => cCargo === x || cCargo.startsWith(x));

  if (filterCargo && isIncompat && !hasEvidence && !c.recent_evidence) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `cargo incompatível: ${cCargo} vs ${filterCargo}` };
  }
  if (filterCargo && filterCargo !== "presidente" && uf && cUf && cUf !== uf && !hasEvidence) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `UF incompatível: ${cUf} vs ${uf}` };
  }

  // Componentes 0-100.
  const recent = c.recent_evidence ? 1 : 0;
  const poll = c.poll_evidence ? 1 : 0;
  const monthsAgo = typeof c.last_mention_months === "number" ? c.last_mention_months : 12;

  const media = Math.max(0, Math.min(100, (recent ? 70 : 25) + (poll ? 25 : 0) + (cargoMatch ? 5 : 0)));
  const relevance = Math.max(0, Math.min(100, (poll ? 70 : 35) + (recent ? 25 : 0) + (hasEvidence ? 5 : 0)));
  const viability = Math.max(0, Math.min(100, Number(c.confidence) || 0));
  const recency = Math.max(0, 100 - Math.min(monthsAgo * 10, 100));

  let score = 0.15 * media + 0.15 * relevance + 0.55 * viability + 0.15 * recency;
  if (c.only_historical) score -= 25;
  if (typeof c.last_mention_months === "number" && c.last_mention_months > 12) score -= 20;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Elegibilidade — independe do score.
  const inel = lookupIneligible(c.nome);
  const eligible = !inel;
  const ineligibleReason = inel ? inel.reason : null;

  let tier: Tier;
  if (!eligible) tier = "inelegivel";
  else if (score >= 85) tier = "forte";
  else if (score >= 60) tier = "possivel";
  else if (score >= 40) tier = "fraco";
  else tier = "fraco";

  // Inelegíveis sempre aparecem (com badge vermelho). Demais: keep se >= 40.
  const keep = !eligible || score >= 40;
  return { score, keep, tier, eligible, ineligibleReason, why: `score=${score} tier=${tier} elig=${eligible} cargo=${cCargo} uf=${cUf} recent=${recent} poll=${poll} hist=${c.only_historical}` };
}

const NATIONAL_CARGOS = ["presidente", "vice-presidente", "vice presidente", "ministro", "presidente de partido"];
const REGIONAL_CARGOS_REQUIRE_UF = ["governador", "vice-governador", "senador", "deputado federal", "deputado estadual"];
const LOCAL_CARGOS_REQUIRE_MUN = ["prefeito", "vice-prefeito", "vereador"];

// Seed nacional para garantir resultado quando IA/Web ficam indisponíveis.
const NATIONAL_SEED: ExtractedCandidate[] = [
  { nome: "Luiz Inácio Lula da Silva", partido: "PT", cargo: "presidente", estado: null, municipio: null, confidence: 95, reason: "presidente em exercício, pré-candidato à reeleição em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 0 },
  { nome: "Tarcísio de Freitas", partido: "REPUBLICANOS", cargo: "presidente", estado: null, municipio: null, confidence: 90, reason: "cotado para a presidência da república em 2026 (Datafolha/Quaest)", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 0 },
  { nome: "Romeu Zema", partido: "NOVO", cargo: "presidente", estado: null, municipio: null, confidence: 84, reason: "cotado como pré-candidato à presidência da república em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 2 },
  { nome: "Ronaldo Caiado", partido: "UNIÃO", cargo: "presidente", estado: null, municipio: null, confidence: 82, reason: "lançou pré-candidatura à presidência da república em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
  { nome: "Ratinho Junior", partido: "PSD", cargo: "presidente", estado: null, municipio: null, confidence: 80, reason: "pré-candidato à presidência da república em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
  { nome: "Eduardo Leite", partido: "PSDB", cargo: "presidente", estado: null, municipio: null, confidence: 72, reason: "articula pré-candidatura à presidência da república em 2026", recent_evidence: true, poll_evidence: false, only_historical: false, last_mention_months: 3 },
  // Inelegível — mantido para que UI mostre badge 🔴, viability baixa.
  { nome: "Jair Bolsonaro", partido: "PL", cargo: "presidente", estado: null, municipio: null, confidence: 40, reason: "inelegível pelo TSE até 2030; articula indicação de candidato apoiado", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 0 },
  // Cotação mais baixa: nome ventilado mas sem liderança em pesquisas presidenciais.
  { nome: "Fernando Haddad", partido: "PT", cargo: "presidente", estado: null, municipio: null, confidence: 35, reason: "ministro da Fazenda; nome ventilado para presidência caso Lula não dispute", recent_evidence: true, poll_evidence: false, only_historical: false, last_mention_months: 2 },
];

// Seed regional para governador — usado quando IA retorna 0 para "governador" + UF.
const GOVERNADOR_SEED: Record<string, ExtractedCandidate[]> = {
  SP: [
    { nome: "Tarcísio de Freitas", partido: "REPUBLICANOS", cargo: "governador", estado: "SP", municipio: null, confidence: 90, reason: "governador em exercício, cotado para reeleição ou presidência em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 0 },
    { nome: "Fernando Haddad", partido: "PT", cargo: "governador", estado: "SP", municipio: null, confidence: 65, reason: "nome ventilado pelo PT para disputar governo de SP em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 2 },
    { nome: "Márcio França", partido: "PSB", cargo: "governador", estado: "SP", municipio: null, confidence: 55, reason: "ex-governador, cotado pelo PSB para governo de SP em 2026", recent_evidence: true, poll_evidence: false, only_historical: false, last_mention_months: 3 },
    { nome: "Guilherme Boulos", partido: "PSOL", cargo: "governador", estado: "SP", municipio: null, confidence: 50, reason: "deputado federal, cotado pela esquerda para governo de SP em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 2 },
    { nome: "Paulo Serra", partido: "PSDB", cargo: "governador", estado: "SP", municipio: null, confidence: 45, reason: "prefeito de Santo André, cotado pelo PSDB para governo de SP", recent_evidence: true, poll_evidence: false, only_historical: false, last_mention_months: 4 },
  ],
  MG: [
    { nome: "Romeu Zema", partido: "NOVO", cargo: "governador", estado: "MG", municipio: null, confidence: 70, reason: "governador em fim de mandato, articula sucessão e disputa presidencial", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
    { nome: "Cleitinho Azevedo", partido: "REPUBLICANOS", cargo: "governador", estado: "MG", municipio: null, confidence: 60, reason: "senador, cotado para governo de MG em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 2 },
    { nome: "Rodrigo Pacheco", partido: "PSD", cargo: "governador", estado: "MG", municipio: null, confidence: 58, reason: "presidente do Senado, cotado para governo de MG em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
  ],
  RJ: [
    { nome: "Cláudio Castro", partido: "PL", cargo: "governador", estado: "RJ", municipio: null, confidence: 70, reason: "governador em exercício, articula reeleição em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
    { nome: "Eduardo Paes", partido: "PSD", cargo: "governador", estado: "RJ", municipio: null, confidence: 65, reason: "prefeito do Rio, cotado pelo PSD para governo do RJ em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 2 },
  ],
  RS: [
    { nome: "Eduardo Leite", partido: "PSDB", cargo: "governador", estado: "RS", municipio: null, confidence: 75, reason: "governador em exercício do RS, cotado para reeleição ou presidência", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
  ],
  GO: [
    { nome: "Ronaldo Caiado", partido: "UNIÃO", cargo: "governador", estado: "GO", municipio: null, confidence: 70, reason: "governador em fim de mandato, articula sucessão e disputa presidencial", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 1 },
  ],
  PR: [
    { nome: "Ratinho Junior", partido: "PSD", cargo: "governador", estado: "PR", municipio: null, confidence: 80, reason: "governador em exercício, articula candidatura presidencial em 2026", recent_evidence: true, poll_evidence: true, only_historical: false, last_mention_months: 0 },
  ],
};

async function discoverPreCandidates(body: Body): Promise<any[]> {
  const filterCargo = normalizeText(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();

  const isNational = NATIONAL_CARGOS.includes(filterCargo);
  const requiresUF = REGIONAL_CARGOS_REQUIRE_UF.includes(filterCargo);
  const requiresMun = LOCAL_CARGOS_REQUIRE_MUN.includes(filterCargo);

  console.log("estado raw:", body.estado);
  console.log("estado normalized:", uf);
  console.log("cargo raw:", body.cargo, "→ normalized:", filterCargo);
  console.log("IS NATIONAL:", isNational);
  console.log("STATE REQUIRED:", requiresUF || requiresMun);
  console.log("MUN REQUIRED:", requiresMun);

  // Bloqueio para cargos regionais sem UF.
  if (requiresUF && !uf) {
    console.warn(`[hybrid] cargo "${filterCargo}" exige estado — abortando`);
    return [];
  }
  if (requiresMun && (!uf || !mun)) {
    console.warn(`[hybrid] cargo "${filterCargo}" exige estado e município — abortando`);
    return [];
  }

  // Para cargos nacionais, ignora UF/município no body antes de gerar queries.
  const queryBody: Body = isNational ? { ...body, estado: null, municipio: null, regiao: null } : body;
  const queries = buildQueries(queryBody);
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

  let extracted = await extractCandidatesFromWeb(queryBody, hits, queries);
  console.log("AI RESULTS (raw):", extracted.length);

  // Garantia: para cargos nacionais (presidente), se IA retornar 0, usa seed conhecido.
  if (isNational && extracted.length === 0) {
    console.warn("[hybrid] IA retornou 0 para cargo nacional — aplicando seed");
    extracted = NATIONAL_SEED.filter((c) => !filterCargo || c.cargo === filterCargo);
  }

  // Pós-processamento estrito por cargo/estado/município (UF/mun ignorados para nacional).
  const effUf = isNational ? "" : uf;
  const effMun = isNational ? "" : mun;
  const rows: any[] = [];
  for (const c of extracted) {
    const r = scoreRelevance(c, filterCargo, effUf, effMun);
    if (!r.keep) { console.log("[hybrid] descartado:", c.nome, "—", r.why); continue; }
    rows.push(toRow(c, filterCargo, { score: r.score, tier: r.tier, eligible: r.eligible, ineligibleReason: r.ineligibleReason }));
  }
  rows.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));
  console.log("AI RESULTS (filtrados):", rows.length);
  return rows;
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
