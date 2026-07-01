// Busca híbrida: TSE oficial + descoberta dinâmica de pré-candidatos via IA + Web.
// SEM banco pré-populado. Pré-candidatos descobertos em tempo real via Firecrawl + LLM.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { normalizeName } from "../_shared/normalize-name.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import {
  canonicalCargoKey,
  electionYearForCargo,
  MUNICIPAL_CARGO_KEYS,
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

function normalizeCandidateType(value: Body["candidateType"]): "official" | "pre_candidate" | "both" | "ai" {
  return value === "official" || value === "pre_candidate" || value === "ai" || value === "both"
    ? value
    : "both";
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

// Mapa UF (sigla) → nome completo do estado. Obrigatório para enviar nomes legíveis à IA/busca web.
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
  const code = String(uf).toUpperCase().slice(0, 2);
  return UF_TO_NAME[code] || String(uf);
}

function buildCargoQueries(cargo: string, estado?: string, municipio?: string): string[] {
  const estadoNome = ufFullName(estado);
  const cargoLabel = cargo.replace(/_/g, " ");
  switch (cargo) {
    case "presidente":
      return [
        "pré-candidatos presidente brasil 2026",
        "candidatos presidência da república 2026",
      ];
    case "governador":
      return [
        `pré-candidato governador ${estadoNome || "brasil"} 2026`,
        `candidatos governo ${estadoNome || ""} 2026 pesquisa eleitoral`,
        `quem vai disputar governo ${estadoNome || ""} 2026`,
      ];
    case "prefeito":
      return [
        `pré-candidatos prefeito ${municipio || ""} ${estadoNome || ""}`,
        `eleições prefeitura ${municipio || ""} ${estadoNome || ""} 2026`,
      ];
    case "vereador":
      return [
        `vereadores em ascensão ${municipio || ""} ${estadoNome || ""}`,
        `pré-candidatos vereador ${municipio || ""} ${estadoNome || ""}`,
        `câmara municipal ${municipio || ""} ${estadoNome || ""}`,
      ];
    case "senador":
      return [
        `pré-candidato senador ${estadoNome || "brasil"} 2026`,
        `senado ${estadoNome || ""} 2026 candidatos`,
      ];
    case "deputado_federal":
      return [`pré-candidatos deputado federal ${estadoNome || "brasil"} 2026`];
    case "deputado_estadual":
      return [`pré-candidatos deputado estadual ${estadoNome || "brasil"} 2026`];
    case "deputado_distrital":
      return [`pré-candidatos deputado distrital ${estadoNome || "Distrito Federal"} 2026`];
    default:
      return cargo ? [`pré-candidato ${cargoLabel} ${municipio || ""} ${estadoNome || ""} 2026`] : [];
  }
}

function buildQueries(body: Body): string[] {
  const qs: string[] = [];
  const q = (body.q || "").trim();
  const cargo = normalizeCargo(body.cargo);
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
  held_major_office?: boolean; // já foi governador/senador/ministro/prefeito de capital
  party_signaling?: boolean;   // partido sinaliza candidatura competitiva
}

async function extractCandidatesFromWeb(
  body: Body, hits: WebHit[], queries: string[],
): Promise<ExtractedCandidate[]> {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const estadoNome = ufFullName(uf);
  const mun = body.municipio || "";
  console.log("UF raw:", body.estado, "→ sigla:", uf, "→ nome:", estadoNome);
  const evidence = hits.length
    ? hits.slice(0, 12).map((h, i) =>
      `[${i + 1}] ${h.title ?? ""}\n${h.description ?? ""}\n${h.url ?? ""}`
    ).join("\n---\n").slice(0, 6000)
    : `Sem resultados web disponíveis neste momento. Consultas geradas: ${queries.join(" | ")}`;

  const system = `Você é um analista político brasileiro. Extraia pré-candidatos a cargos eletivos no Brasil para 2026 a partir de evidências da web. Responda SEMPRE em JSON estrito.`;
  const user = `Filtros do usuário:
- Cargo: ${cargo || "qualquer"}
- Estado: ${estadoNome || "qualquer"}${uf ? ` (sigla ${uf})` : ""}
- Município: ${mun || "qualquer"}
- Nome buscado: ${body.q || "—"}
Data atual: ${new Date().toISOString().slice(0, 10)}

Evidências (resultados de busca recente):
${evidence}

${cargo === "governador" && estadoNome ? `Liste nomes realisticamente cotados para disputar o governo de ${estadoNome} em 2026.
Considere: pesquisas eleitorais, bastidores partidários, notícias dos últimos 12 meses e nomes fortes regionais.
NÃO limite a capitais ou estados grandes. Inclua nomes regionais relevantes mesmo em estados menores (AC, AP, RR, TO, SE, PI etc.).

` : ""}

Para cada PESSOA REAL, BRASILEIRA, retorne APENAS nomes REALISTICAMENTE COTADOS a disputar o CARGO filtrado em 2026.
NÃO basta ser "político relevante" no estado. Exige-se viabilidade real de candidatura ao cargo específico.

CRITÉRIOS OBRIGATÓRIOS — incluir o nome SOMENTE se atender pelo menos 2 dos 4:
  (a) "held_major_office": já foi governador, senador, ministro de Estado OU prefeito de capital;
  (b) "poll_evidence": aparece em pesquisa eleitoral recente (Datafolha, Quaest, AtlasIntel, Paraná Pesquisas, Genial/Quaest) para o cargo filtrado;
  (c) "recent_evidence": citado em notícias eleitorais dos últimos 180 dias como cotado/articulado para o cargo;
  (d) "party_signaling": o partido dele sinalizou candidatura competitiva ao cargo (não apenas filiação).

NÃO incluir político só por: morar no estado, ser deputado estadual/local, ser ex-prefeito de cidade pequena/média, ter notoriedade municipal, ou ser do mesmo partido de alguém forte.

REGRAS DE CARGO:
- Cargo "governador" + Estado="${estadoNome || "[ESTADO]"}" (sigla ${uf || "[UF]"}): apenas cotados ao GOVERNO de ${estadoNome || "[ESTADO]"}. Use "estado": "${uf || "[UF]"}" (sigla 2 letras).
- Cargo "presidente": apenas cotados à presidência da República.
- Cargo "senador"/"deputado federal"/"deputado estadual": apenas para o estado filtrado.
- Cargo "prefeito"/"vereador": apenas para o município filtrado.
- "cargo" do item DEVE bater com o cargo filtrado.
- "estado" SEMPRE em sigla 2 letras (SP, RJ, MG…).
- "reason": evidência curta (ex.: "ex-prefeito de SP, 22% no Datafolha out/2025 para governo de SP").
- "confidence" (0-100): viabilidade política real. Tier 1 (85-100) fortemente cotado; Tier 2 (60-84) possível; <60 fraco — NÃO RETORNE <60.
- "only_historical": true se a relevância é só passada.
- "last_mention_months": meses desde menção relevante (ou null).
NÃO invente nomes. Máximo 10 itens, ordenados por confidence desc. NÃO retorne itens com confidence < 60.

JSON estrito:
{ "candidatos": [
  { "nome": string, "partido": string|null, "cargo": string|null,
    "estado": string|null, "municipio": string|null,
    "confidence": number, "reason": string,
    "recent_evidence": boolean, "poll_evidence": boolean,
    "held_major_office": boolean, "party_signaling": boolean,
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
        held_major_office: !!c.held_major_office,
        party_signaling: !!c.party_signaling,
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
  const fallback = (c.cargo || fallbackCargo || "").toLowerCase().replace(/\s+/g, "_") || null;
  const cargo = canonicalCargoKey(c.cargo) ?? canonicalCargoKey(fallbackCargo) ?? fallback;
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
  governador: ["presidente", "senador", "deputado_federal", "deputado_estadual", "prefeito", "vereador", "ministro"],
  presidente: ["governador", "senador", "deputado_federal", "deputado_estadual", "prefeito", "vereador"],
  senador: ["presidente", "vereador", "prefeito"],
  prefeito: ["presidente", "governador", "senador", "vereador"],
  vereador: ["presidente", "governador", "senador", "deputado_federal"],
};

function evidenceOfCandidacy(reason: string, filterCargo: string, uf: string, mun: string): boolean {
  const r = (reason || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!filterCargo) return false;
  const cargoTokens: Record<string, string[]> = {
    governador: ["governo", "governador"],
    presidente: ["presidencia", "presidente da republica"],
    senador: ["senado", "senador"],
    deputado_federal: ["deputado federal", "camara"],
    deputado_estadual: ["deputado estadual", "assembleia"],
    deputado_distrital: ["deputado distrital", "camara legislativa"],
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
  const cCargo = canonicalCargoKey(c.cargo) ?? normalizeText(c.cargo);
  const cUf = (c.estado || "").toUpperCase();
  const cMun = (c.municipio || "").trim().toLowerCase();

  // Nome completo (≥ 2 partes).
  const parts = (c.nome || "").trim().split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length < 2) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: "nome incompleto" };
  }

  // REGRA 3 — filtro rígido de cargo (sem "include", sem incompatíveis).
  if (filterCargo && cCargo && cCargo !== filterCargo) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `cargo ≠ filtro: ${cCargo} vs ${filterCargo}` };
  }

  // REGRA 4 — cargos estaduais/federais: exige mesmo UF.
  const requiresUF = REGIONAL_CARGOS_REQUIRE_UF.includes(filterCargo);
  if (requiresUF && uf && cUf !== uf) {
    return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `UF ≠ filtro: ${cUf} vs ${uf}` };
  }

  // REGRA 5 — cargos municipais: exige mesmo UF + município.
  const requiresMun = LOCAL_CARGOS_REQUIRE_MUN.includes(filterCargo);
  if (requiresMun) {
    if (!uf || !mun) {
      return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: "cargo municipal exige UF+município" };
    }
    if (cUf && cUf !== uf) {
      return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `UF ≠ filtro (municipal): ${cUf} vs ${uf}` };
    }
    const munNorm = mun.toLowerCase();
    if (cMun && cMun !== munNorm) {
      return { score: 0, keep: false, tier: "fraco", eligible: true, ineligibleReason: null, why: `município ≠ filtro: ${cMun} vs ${munNorm}` };
    }
  }

  // REGRA 6 — score IA: mentions*0.35 + engagement*0.25 + polls*0.25 + news*0.15
  const mentions = c.recent_evidence ? 100 : (c.last_mention_months != null && c.last_mention_months <= 6 ? 60 : 20);
  const engagement = Math.max(0, Math.min(100, Number(c.confidence) || 0)); // proxy
  const polls = c.poll_evidence ? 100 : 0;
  const news = c.recent_evidence ? 100 : (c.held_major_office || c.party_signaling ? 50 : 0);
  let score = mentions * 0.35 + engagement * 0.25 + polls * 0.25 + news * 0.15;
  if (c.only_historical) score -= 25;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const inel = lookupIneligible(c.nome);
  const eligible = !inel;
  const ineligibleReason = inel ? inel.reason : null;

  let tier: Tier;
  if (!eligible) tier = "inelegivel";
  else if (score >= 90) tier = "forte";
  else if (score >= 75) tier = "possivel"; // "Cotado"
  else if (score >= 60) tier = "possivel"; // "Possível"
  else tier = "fraco";

  const keep = !eligible || score >= 60;
  return { score, keep, tier, eligible, ineligibleReason, why: `score=${score} tier=${tier} elig=${eligible}` };
}


const NATIONAL_CARGOS = ["presidente", "vice_presidente", "ministro"];
const REGIONAL_CARGOS_REQUIRE_UF = ["governador", "vice_governador", "senador", "deputado_federal", "deputado_estadual", "deputado_distrital"];
const LOCAL_CARGOS_REQUIRE_MUN = ["prefeito", "vice_prefeito", "vereador"];

// REGRA 2 — seeds por cargo. Cada cargo tem sua base própria.
// Presidente 2026 (REGRA 7): lista realista, sem Haddad/Ciro.
const NATIONAL_SEED: ExtractedCandidate[] = [
  { nome: "Luiz Inácio Lula da Silva", partido: "PT", cargo: "presidente", estado: null, municipio: null, confidence: 95, reason: "presidente em exercício, pré-candidato à reeleição em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 0 },
  { nome: "Tarcísio de Freitas", partido: "REPUBLICANOS", cargo: "presidente", estado: null, municipio: null, confidence: 92, reason: "governador de SP, forte cotado para presidência em 2026 (Datafolha/Quaest)", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 0 },
  { nome: "Ratinho Junior", partido: "PSD", cargo: "presidente", estado: null, municipio: null, confidence: 82, reason: "governador do PR, pré-candidato à presidência em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 1 },
  { nome: "Ronaldo Caiado", partido: "UNIÃO", cargo: "presidente", estado: null, municipio: null, confidence: 80, reason: "governador de GO, pré-candidato à presidência em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 1 },
  { nome: "Romeu Zema", partido: "NOVO", cargo: "presidente", estado: null, municipio: null, confidence: 82, reason: "governador de MG, pré-candidato à presidência em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 2 },
  { nome: "Eduardo Leite", partido: "PSDB", cargo: "presidente", estado: null, municipio: null, confidence: 72, reason: "governador do RS, articula pré-candidatura presidencial em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 3 },
  { nome: "Flávio Bolsonaro", partido: "PL", cargo: "presidente", estado: null, municipio: null, confidence: 70, reason: "senador RJ, cotado como nome do PL para presidência em 2026", recent_evidence: true, poll_evidence: true, held_major_office: false, party_signaling: true, only_historical: false, last_mention_months: 1 },
  { nome: "Michelle Bolsonaro", partido: "PL", cargo: "presidente", estado: null, municipio: null, confidence: 68, reason: "presidente do PL Mulher, ventilada pelo PL para presidência em 2026", recent_evidence: true, poll_evidence: true, held_major_office: false, party_signaling: true, only_historical: false, last_mention_months: 1 },
];

// REGRA 2 — Seeds por cargo. Expandir conforme cobertura.
const PRE_CANDIDATE_SEEDS: Record<string, ExtractedCandidate[]> = {
  presidente: NATIONAL_SEED,
  governador: [],
  prefeito: [],
  senador: [],
  deputado_federal: [],
  deputado_estadual: [],
  vereador: [],
};

// Seed regional para governador (fallback quando IA/Web = 0).
const GOVERNADOR_SEED: Record<string, ExtractedCandidate[]> = {
  SP: [
    { nome: "Tarcísio de Freitas", partido: "REPUBLICANOS", cargo: "governador", estado: "SP", municipio: null, confidence: 90, reason: "governador em exercício de SP, cotado para reeleição em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 0 },
    { nome: "Márcio França", partido: "PSB", cargo: "governador", estado: "SP", municipio: null, confidence: 65, reason: "ex-governador de SP, cotado pelo PSB para governo de SP em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 3 },
    { nome: "Guilherme Boulos", partido: "PSOL", cargo: "governador", estado: "SP", municipio: null, confidence: 62, reason: "deputado federal, cotado pela esquerda para governo de SP em 2026", recent_evidence: true, poll_evidence: true, held_major_office: false, party_signaling: true, only_historical: false, last_mention_months: 2 },
  ],
  MG: [
    { nome: "Cleitinho Azevedo", partido: "REPUBLICANOS", cargo: "governador", estado: "MG", municipio: null, confidence: 65, reason: "senador por MG, cotado para governo de MG em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 2 },
    { nome: "Rodrigo Pacheco", partido: "PSD", cargo: "governador", estado: "MG", municipio: null, confidence: 70, reason: "ex-presidente do Senado, cotado pelo PSD para governo de MG em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 1 },
  ],
  RJ: [
    { nome: "Cláudio Castro", partido: "PL", cargo: "governador", estado: "RJ", municipio: null, confidence: 72, reason: "governador em exercício do RJ, articula reeleição em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 1 },
    { nome: "Eduardo Paes", partido: "PSD", cargo: "governador", estado: "RJ", municipio: null, confidence: 70, reason: "prefeito do Rio, cotado pelo PSD para governo do RJ em 2026", recent_evidence: true, poll_evidence: true, held_major_office: true, party_signaling: true, only_historical: false, last_mention_months: 2 },
  ],
};


async function discoverPreCandidates(body: Body): Promise<any[]> {
  const filterCargo = normalizeCargo(body.cargo);
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
  console.log("AI RESULTS (raw):", extracted.length, extracted.map((c) => `${c.nome} (${c.confidence})`).join(" | "));

  // Fallback seeds quando IA retorna 0.
  if (extracted.length === 0) {
    if (isNational) {
      console.warn("[hybrid] IA retornou 0 para cargo nacional — aplicando NATIONAL_SEED");
      extracted = NATIONAL_SEED.filter((c) => !filterCargo || c.cargo === filterCargo);
    } else if (filterCargo === "governador" && uf && GOVERNADOR_SEED[uf]) {
      console.warn(`[hybrid] IA retornou 0 para governador ${uf} — aplicando GOVERNADOR_SEED`);
      extracted = GOVERNADOR_SEED[uf];
    }
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
    const rawBody = (await req.json()) as Body;
    const body = sanitizeBody(rawBody);
    const candidateType = normalizeCandidateType(body.candidateType);
    const authHeader = req.headers.get("Authorization");
    const page = body.page ?? 0;

    const cargo = normalizeCargo(body.cargo);
    const electionYear = cargo ? electionYearForCargo(cargo) : null;
    const municipio = body.municipio ?? null;
    const querySql = `delegated catalog SQL: cargo=${cargo ?? "null"}; year=${electionYear ?? "null"}; municipio=${municipio ?? "null"}`;

    console.log("RAW FILTERS", rawBody);
    console.log("RAW CARGO:", rawBody.cargo);
    console.log("NORMALIZED CARGO", cargo);
    console.log("YEAR", electionYear);
    console.log("MUNICIPIO", municipio);
    console.log("QUERY SQL", querySql);

    const wantsTSE = candidateType === "official" || candidateType === "both";
    const wantsAI = candidateType === "pre_candidate" || candidateType === "ai" || candidateType === "both";

    console.log("[hybrid] CATALOG MODE:", candidateType, "wantsTSE:", wantsTSE, "wantsAI:", wantsAI);

    if (candidateType === "pre_candidate" || candidateType === "ai") {
      // Para cargos municipais (vereador/prefeito/vice_prefeito) priorizar TSE oficial 2024.
      // Só cair para IA se TSE retornar 0.
      const cargoNorm = normalizeCargo(body.cargo);
      const isMunicipal = MUNICIPAL_CARGO_KEYS.has(cargoNorm as any);
      const munRaw = body.municipio || "";
      const munNorm = munRaw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
      const electionYear = cargoNorm ? electionYearForCargo(cargoNorm) : 2022;
      console.log("cargo raw:", body.cargo, "→ normalized:", cargoNorm);
      console.log("municipio raw:", munRaw, "→ normalized:", munNorm);
      console.log("year:", electionYear);

      let tseRows: any[] = [];
      if (isMunicipal && munRaw && firstValue(body.estado)) {
        const tse = await callTSE(body, authHeader);
        tseRows = (tse.rows ?? []).map((r: any) => ({
          ...r,
          candidate_type: "official" as const,
          confidence_score: r.eleito ? 100 : 85,
          confidence_tier: r.eleito ? "forte" : "possivel",
          is_eligible: true,
        }));
        console.log("[hybrid] TSE rows (municipal priority):", tseRows.length);
      }

      const aiRows = tseRows.length === 0 ? await discoverPreCandidates(body) : [];
      const merged = tseRows.length > 0 ? tseRows : aiRows;
      const total = merged.length;
      const start = page * PAGE_SIZE;
      const paged = merged.slice(start, start + PAGE_SIZE);
      console.log("[hybrid] TSE COUNT:", tseRows.length);
      console.log("[hybrid] AI COUNT:", aiRows.length);
      console.log("[hybrid] FINAL COUNT:", total);
      console.log("ROWS FOUND", paged.length);

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
        sources: [
          ...(tseRows.length ? ["tse"] : []),
          ...(aiRows.length ? ["ai_web"] : []),
        ],
        counts: {
          official: tseRows.length,
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
    console.log("ROWS FOUND", paged.length);

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
