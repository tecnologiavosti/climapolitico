// Political Actor Discovery Engine
// Hybrid: TSE oficial (histórico) + descoberta dinâmica de atores políticos via Web + IA.
// SEM listas fixas, SEM seeds, SEM banco pré-populado.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
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

async function firecrawlSearch(query: string, tbs = "qdr:y", limit = 10): Promise<WebHit[]> {
  if (!FIRECRAWL_API_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit, lang: "pt", country: "br", tbs }),
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
    return items.slice(0, limit).map((it: any) => ({
      title: it?.title,
      description: it?.description ?? it?.snippet ?? it?.markdown?.slice?.(0, 700),
      url: it?.url,
    }));
  } catch (e) { console.warn("[discovery] firecrawl err", e); return []; }
}

// Nomes muito genéricos: exigem evidência política forte para não virar falso positivo.
const GENERIC_NAME_TOKENS = new Set([
  "silva", "souza", "sousa", "santos", "oliveira", "pereira", "lima",
  "ferreira", "almeida", "ribeiro", "rodrigues", "gomes", "martins",
  "carvalho", "araujo", "barbosa", "rocha", "dias", "nascimento", "moreira",
  "costa", "cardoso", "teixeira", "correia", "correa", "melo", "mello",
]);
const GENERIC_FIRST_NAMES = new Set([
  "jose", "joao", "maria", "antonio", "luis", "luiz", "carlos", "paulo",
  "pedro", "francisco", "manoel", "manuel", "ana", "marcos",
]);
function isGenericName(nome: string): boolean {
  const toks = normalizeName(nome).split(/\s+/).filter(Boolean);
  if (toks.length < 2) return true;
  const first = toks[0];
  const last = toks[toks.length - 1];
  return GENERIC_FIRST_NAMES.has(first) && GENERIC_NAME_TOKENS.has(last);
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
  nationalRelevance?: number;
  electoralViability?: number;
  mentions?: number;
  engagement?: number;
  sentiment?: number;
  // Motor v2 (mantido para compat)
  intentionScore?: number;
  socialScore?: number;
  mediaScore?: number;
  historyScore?: number;
  criteriaMet?: number;
  continuityScore?: number;
  politicalEngagementScore?: number;
  localMediaScore?: number;
  // Motor v3 (0-100 cada, ponderado no confidence)
  historicalStrength?: number;   // 15%
  politicalActivity?: number;    // 20%
  socialSignal?: number;         // 20%
  mediaSignal?: number;          // 20%
  candidacyIntent?: number;      // 25% — evidência REAL de intenção
  presidentialChecks?: number;   // 0-5 checkboxes presidenciais
  ignoredReason?: string | null;
}

interface HistoricalMunicipalCandidate {
  nome: string;
  nome_urna?: string | null;
  partido_sigla?: string | null;
  cargo?: string | null;
  estado?: string | null;
  municipio?: string | null;
  eleito: boolean;
  ano_eleicao: number | null;
  popularidade: number;
}

function titleCaseName(value: string): string {
  const small = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part, idx) => small.has(part) && idx > 0 ? part : part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function municipalStatus(score: number): "forte" | "cotado" | "possivel" | "emergente" {
  if (score >= 85) return "forte";
  if (score >= 70) return "cotado";
  if (score >= 50) return "possivel";
  return "emergente";
}

function historicalRankScore(row: HistoricalMunicipalCandidate): number {
  const yearBoost = row.ano_eleicao === 2024 ? 8 : row.ano_eleicao === 2020 ? 3 : 0;
  const electedBoost = row.eleito ? 20 : 0;
  const popularity = Math.max(0, Math.min(1, Number(row.popularidade ?? 0))) * 10;
  return electedBoost + yearBoost + popularity;
}

async function getBackendClient() {
  return createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ANON_KEY);
}

async function fetchMunicipalHistory(
  cargo: string,
  uf: string,
  mun: string,
  includeAllMunicipal = false,
): Promise<HistoricalMunicipalCandidate[]> {
  if (!uf || !mun) return [];
  const sb = await getBackendClient();
  const cargos = includeAllMunicipal ? ["vereador", "prefeito"] : [cargo];
  const { data, error } = await sb
    .from("politicians")
    .select("nome,nome_urna,partido_sigla,cargo,estado,municipio,eleito,ano_eleicao,popularidade")
    .eq("ativo", true)
    .eq("estado", uf)
    .ilike("municipio", `%${mun}%`)
    .in("cargo", cargos)
    .in("ano_eleicao", [2020, 2024])
    .order("eleito", { ascending: false })
    .order("ano_eleicao", { ascending: false })
    .order("popularidade", { ascending: false })
    .order("nome", { ascending: true })
    .limit(includeAllMunicipal ? 220 : 140);
  if (error) {
    console.warn("[municipal-engine] TSE history query failed", error.message);
    return [];
  }
  const dedup = new Map<string, HistoricalMunicipalCandidate>();
  for (const row of data ?? []) {
    const key = normalizeName(row.nome || "");
    if (!key) continue;
    const current = {
      nome: row.nome,
      nome_urna: row.nome_urna,
      partido_sigla: row.partido_sigla,
      cargo: row.cargo,
      estado: row.estado,
      municipio: row.municipio,
      eleito: !!row.eleito,
      ano_eleicao: row.ano_eleicao,
      popularidade: Number(row.popularidade ?? 0),
    };
    const prev = dedup.get(key);
    if (!prev || historicalRankScore(current) > historicalRankScore(prev)) dedup.set(key, current);
  }
  return Array.from(dedup.values())
    .sort((a, b) => historicalRankScore(b) - historicalRankScore(a) || a.nome.localeCompare(b.nome))
    .slice(0, includeAllMunicipal ? 120 : 100);
}

async function countMunicipalUniverse(uf: string, mun: string): Promise<number> {
  if (!uf || !mun) return 0;
  const sb = await getBackendClient();
  const { count, error } = await sb
    .from("politicians")
    .select("id", { count: "exact", head: true })
    .eq("ativo", true)
    .eq("estado", uf)
    .ilike("municipio", `%${mun}%`)
    .in("cargo", ["vereador", "prefeito"])
    .in("ano_eleicao", [2020, 2024]);
  if (error) {
    console.warn("[municipal-engine] city universe count failed", error.message);
    return 0;
  }
  return count ?? 0;
}

function buildMunicipalEnrichmentQueries(cargo: string, uf: string, mun: string, history: HistoricalMunicipalCandidate[]): string[] {
  const base = [
    `${mun} ${uf} ${cargo} política local últimos 90 dias`,
    `${mun} ${uf} câmara municipal reunião bairro agenda pública`,
    `${mun} ${uf} eleição municipal ${cargo} política`,
  ];
  const candidateQueries = history.slice(0, 12).map((h) => `"${h.nome_urna || h.nome}" ${mun} ${uf} política ${cargo}`);
  return [...base, ...candidateQueries];
}

async function scoreMunicipalHistoricalActors(
  body: Body,
  history: HistoricalMunicipalCandidate[],
  hits: WebHit[],
): Promise<DiscoveredCandidate[]> {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();
  if (!history.length) return [];

  const allowed = new Map(history.map((h) => [normalizeName(h.nome), h]));
  const list = history.slice(0, 100).map((h, i) =>
    `${i + 1}. ${h.nome} | urna: ${h.nome_urna || "-"} | partido: ${h.partido_sigla || "-"} | cargo TSE: ${h.cargo || "-"} | ${h.eleito ? "eleito" : "não eleito/suplente"} | ano: ${h.ano_eleicao || "-"}`
  ).join("\n");
  const evidence = hits.length
    ? hits.slice(0, 45).map((h, i) => `[${i + 1}] ${h.title ?? ""}\n${h.description ?? ""}\n${h.url ?? ""}`).join("\n---\n").slice(0, 10000)
    : "Sem evidências web recentes. Use somente o histórico TSE abaixo; não invente sinais sociais ou mídia.";

  const system = `Você é um analista político municipal brasileiro. Responda SEMPRE em JSON estrito. Não invente nomes: só pode usar pessoas que aparecem na lista TSE histórica fornecida.`;
  const user = `MOTOR MUNICIPAL — Pré-candidatos IA para ${cargo} em ${mun}/${uf}.

ARQUITETURA OBRIGATÓRIA:
- A fonte principal é o histórico TSE municipal 2020/2024 abaixo.
- Web/rede social/mídia local são apenas enriquecimento; NÃO são a fonte principal.
- Candidato municipal quase nunca aparece em jornal. Se o histórico TSE for forte, a candidatura IA pode ser permitida mesmo sem mídia local.
- Não inclua ninguém fora da lista TSE histórica.

LISTA TSE HISTÓRICA (top por relevância disponível):
${list}

EVIDÊNCIAS DE ENRIQUECIMENTO (web/rede/mídia local; podem estar vazias):
${evidence}

Pontue cada pessoa escolhida:
1) continuityScore 0-35: continua no partido, mandato/cargo público, assessor, diretório, ou TSE recente. Eleito em 2024 ou candidato competitivo em 2024 deve receber continuidade relevante.
2) socialScore 0-30: últimos 90 dias com agenda pública, bairro, visita, reunião, política local em Instagram/Facebook/TikTok/YouTube.
3) engagementScore 0-20: sinais/termos vereador, prefeito, campanha, 2028, eleição, comentários políticos.
4) localMediaScore 0-15: G1 regional, jornais locais, blogs políticos, rádio local.

Score final = soma dos 4 critérios (0-100).
Faixas: 50-69 possível; 70-84 cotado; 85+ forte. Abaixo de 50 não retornar.

JSON estrito:
{ "candidatos": [
  { "name": string, "score": number, "status": "forte"|"cotado"|"possivel", "party": string|null,
    "continuityScore": number, "socialScore": number, "engagementScore": number, "localMediaScore": number,
    "reason": string }
] }`;

  try {
    const ai = await callAICerebrasFirst({
      systemMsg: system,
      userPrompt: user,
      jsonMode: true,
      maxTokens: 3200,
      temperature: 0.15,
      tag: "municipal-discovery-engine",
    });
    const parsed = JSON.parse(ai.content);
    const arr = Array.isArray(parsed?.candidatos) ? parsed.candidatos : [];
    const clamp = (n: any, max: number) => Math.max(0, Math.min(max, Number(n) || 0));
    const out: DiscoveredCandidate[] = [];
    for (const c of arr) {
      const key = normalizeName(c?.name || "");
      const hist = allowed.get(key);
      if (!hist) {
        console.log("PRE_CANDIDATE_AI", { name: c?.name, city: mun, state: uf, cargo, status: "REJECTED (fora do TSE histórico municipal)" });
        continue;
      }
      const continuityScore = clamp(c.continuityScore, 35);
      const socialScore = clamp(c.socialScore, 30);
      const politicalEngagementScore = clamp(c.engagementScore, 20);
      const localMediaScore = clamp(c.localMediaScore, 15);
      const score = Math.round(continuityScore + socialScore + politicalEngagementScore + localMediaScore);
      if (score < 50) {
        console.log("PRE_CANDIDATE_AI", {
          name: hist.nome, city: mun, state: uf, cargo,
          WEB_MATCHES: hits.length, SOCIAL_MATCHES: socialScore, MEDIA_MATCHES: localMediaScore,
          TSE_HISTORY: continuityScore, FINAL_SCORE: score, status: "REJECTED (score<50)",
        });
        continue;
      }
      out.push({
        nome: titleCaseName(hist.nome),
        partido: c.party || hist.partido_sigla || null,
        cargo,
        estado: uf,
        municipio: mun,
        confidence: score,
        status: c.status || municipalStatus(score),
        reason: c.reason ? String(c.reason).slice(0, 300) : `Histórico TSE municipal em ${hist.ano_eleicao}; score municipal ${score}.`,
        continuityScore,
        socialScore,
        politicalEngagementScore,
        localMediaScore,
        criteriaMet: [continuityScore, socialScore, politicalEngagementScore, localMediaScore].filter((v) => v > 0).length,
      });
    }
    return out;
  } catch (e) {
    console.warn("[municipal-engine] ai err", e);
    return [];
  }
}

function buildMunicipalFallbackRows(
  body: Body,
  history: HistoricalMunicipalCandidate[],
  limit = 50,
): DiscoveredCandidate[] {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();
  const nonElected = history.filter((h) => !h.eleito);
  const source = nonElected.length ? nonElected : history;
  return source.slice(0, limit).map((h) => {
    const base = h.ano_eleicao === 2024 ? 52 : 48;
    const continuityScore = h.ano_eleicao === 2024 ? 32 : 25;
    const politicalEngagementScore = h.ano_eleicao === 2024 ? 18 : 15;
    const score = Math.max(50, Math.min(69, Math.round(base + Number(h.popularidade ?? 0) * 8 + (h.eleito ? 5 : 0))));
    return {
      nome: titleCaseName(h.nome),
      partido: h.partido_sigla || null,
      cargo,
      estado: uf,
      municipio: mun,
      confidence: score,
      status: "possivel",
      reason: `Fallback municipal: histórico TSE ${h.ano_eleicao || "recente"} em ${mun}/${uf}. Sem depender de notícia pública.`,
      continuityScore,
      socialScore: 0,
      politicalEngagementScore,
      localMediaScore: 0,
      criteriaMet: 2,
    };
  });
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
1. Só inclua figuras de RELEVÂNCIA NACIONAL COMPROVADA: presidente/ex-presidente, governador/ex-governador de estado grande, senador/ministro de destaque nacional, prefeito de capital com projeção nacional, ou pré-candidato historicamente presidenciável.
2. GROUND TRUTH de candidatos plausíveis (nível de relevância esperado): Lula, Tarcísio, Bolsonaro, Ciro Gomes, Simone Tebet, Sergio Moro, Marina Silva, Romeu Zema, Ronaldo Caiado, Eduardo Leite, Ratinho Junior, Haddad, Pacheco, Michelle Bolsonaro. Nomes fora desse patamar (ex.: Renan Calheiros, Ronaldo Nogueira, deputados sem tração nacional) devem receber scores baixíssimos ou ser omitidos.
3. HARD-BLOCK: jornalistas, comentaristas, apresentadores, influenciadores, celebridades e empresários sem campanha eleitoral ativa.
4. NÃO forçar estado. Infira o estado REAL de cada nome (Lula-SP, Tarcísio-SP, Caiado-GO, Eduardo Leite-RS, Ciro-CE, Marina-AC, Zema-MG, Haddad-SP, Pacheco-MG, Tebet-MS, Ratinho Jr-PR).

Para cada candidato retorne também estas métricas 0-100:
- nationalRelevance: cobertura em mídia nacional + entrevistas + presença em debates + menções em pesquisas eleitorais (Quaest/Datafolha/Paraná Pesquisas). Ex.: Lula=100, Tarcísio=95, Ciro=90, Tebet=75, Renan=25, Ronaldo Nogueira=5.
- electoralViability: já disputou presidência, governa estado grande, partido nacional forte, aparece em pesquisas. Ex.: Lula=100, Tarcísio=95, Ciro=85, Tebet=75, Renan=20, Ronaldo Nogueira=2.
- mentions, engagement, sentiment: 0-100 estimados a partir das evidências e do seu conhecimento.

Fórmula obrigatória do score final:
finalScore = mentions*0.25 + engagement*0.20 + sentiment*0.15 + nationalRelevance*0.20 + electoralViability*0.20
Retorne o campo "score" JÁ CALCULADO por essa fórmula (0-100).
` : "";

  const user = `Identifique pré-candidatos ao cargo de "${cargo || "político"}" em ${local} nas eleições de 2026.

${presidenteRules}

${isStateOrNational && !isPresidente
  ? `Cargo estadual/nacional: use seu conhecimento sobre a política brasileira (governadores, ex-governadores, senadores, deputados, prefeitos de capitais, líderes partidários). Evidências são complemento.`
  : isPresidente
    ? `Combine evidências web + seu conhecimento sobre presidenciáveis reais. Score DEVE seguir a fórmula acima.`
    : `Baseie-se prioritariamente nas evidências. Use apenas nomes REAIS presentes nelas.`}

MOTOR DE CONFIANÇA v2 — 4 CRITÉRIOS (obrigatório para TODOS os cargos):
Para cada nome, atribua pontuação nos 4 critérios abaixo com base APENAS nas evidências fornecidas
(ou, para presidente/governador, também no seu conhecimento sobre política brasileira ATUAL).
Não inclua alguém apenas porque o nome apareceu em PDF antigo ou lista genérica.

C1 — Intenção eleitoral explícita (0 a 40):
  +40 se há trecho contendo termos como "pré-candidato", "pré-candidatura", "deve concorrer",
  "pretende disputar", "candidato a ${cargo || "cargo"}", "eleição 2026/2028", "disputa eleitoral".
  0 se não houver menção explícita.

C2 — Atividade política em redes/agenda pública (0 a 25):
  Sinais nos últimos 90 dias: agenda pública, visitas a bairros, reuniões partidárias, discurso,
  posts sobre mandato, críticas à gestão, inaugurações, eventos eleitorais.
  0 se conta inativa ou sem sinais.

C3 — Cobertura em mídia local/regional (0 a 20):
  Jornais locais, portais regionais, blogs políticos, rádio. Exemplos: "cotado para prefeitura",
  "pode disputar", entrevistas. 0 se ausente.

C4 — Histórico político real (0 a 15):
  Já foi candidato TSE, suplente, vereador, assessor parlamentar, secretário, dirigente partidário.
  0 se histórico desconhecido/nulo.

finalScore = C1 + C2 + C3 + C4  (0-100).

REGRA DE APROVAÇÃO:
- Se finalScore < 60 → NÃO retorne o nome.
- Para PREFEITO/VEREADOR: exigir pelo menos 2 dos 4 critérios com pontuação > 0.
- Rejeite nomes muito genéricos (ex.: "José Silva", "Maria Souza") sem evidência forte (C1>=30 ou C3>=15).
- Nunca invente nomes. Prefira retornar lista vazia a produzir falsos positivos.

${presidenteRules}

${isStateOrNational && !isPresidente
  ? `Cargo estadual/nacional: complemente evidências com seu conhecimento sobre política brasileira recente.`
  : isPresidente
    ? `Combine evidências web + conhecimento sobre presidenciáveis reais. Score DEVE seguir a fórmula presidencial (não a v2).`
    : `Cargo municipal: use APENAS as evidências. Não invente. Se as evidências forem fracas, retorne lista vazia.`}

Cargo filtrado: ${cargo || "qualquer"}
Estado filtro: ${estadoNome} (${uf || "-"})
Município: ${mun || "-"}

Evidências:
${evidence}

MOTOR v3 — MÉTRICAS OBRIGATÓRIAS (0-100 cada):
Para CADA nome retorne também:
- historicalStrength: força eleitoral histórica (votos, mandatos, filiação antiga).
- politicalActivity: atividade política concreta nos últimos 180 dias (agenda, eventos, articulações partidárias).
- socialSignal: intensidade e engajamento em redes sociais recentes.
- mediaSignal: cobertura em mídia local/regional/nacional recente.
- candidacyIntent: EVIDÊNCIA REAL de intenção de disputar (frases como "sou pré-candidato", "pretendo disputar", "vou concorrer", "candidatura", "eleição 2026/2028", "articulação partidária", "convenção", "cotado para", "nome forte", "sucessão", entrevistas confirmando disputa). Se NÃO houver nenhuma evidência dessas nos últimos 180 dias, retorne 0. NÃO invente intenção.
${isPresidente ? `- presidentialChecks (0-5): quantos destes se aplicam: (a) aparece em pesquisas eleitorais nacionais; (b) mídia nacional cita como presidenciável; (c) partido articula candidatura presidencial; (d) capital político nacional consolidado; (e) cargo atual relevante (presidente, governador de estado grande, senador de destaque, ministro).` : ""}

JSON estrito:
{ "candidatos": [
  { "name": string, "score": number, "status": "forte"|"cotado"|"possivel"|"emergente",
    "party": string|null, "role": string|null, "state": string|null,
    "category": "politico"|"jornalista"|"influenciador"|"empresario"|"celebridade"|"outro",
    "intentionScore": number, "socialScore": number, "mediaScore": number, "historyScore": number,
    "historicalStrength": number, "politicalActivity": number, "socialSignal": number, "mediaSignal": number, "candidacyIntent": number,
    ${isPresidente ? `"presidentialChecks": number, "mentions": number, "engagement": number, "sentiment": number, "nationalRelevance": number, "electoralViability": number,` : ""}
    "reason": string }
] }`;

  try {
    const ai = await callAICerebrasFirst({
      systemMsg: system, userPrompt: user, jsonMode: true,
      maxTokens: 2600, temperature: 0.2, tag: "discovery-engine",
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
      .map((c: any): DiscoveredCandidate => {
        const clamp = (n: any, max = 100) => Math.max(0, Math.min(max, Number(n) || 0));
        const mentions = clamp(c.mentions);
        const engagement = clamp(c.engagement);
        const sentiment = clamp(c.sentiment);
        const nationalRelevance = clamp(c.nationalRelevance);
        const electoralViability = clamp(c.electoralViability);
        const intentionScore = clamp(c.intentionScore, 40);
        const socialScore = clamp(c.socialScore, 25);
        const mediaScore = clamp(c.mediaScore, 20);
        const historyScore = clamp(c.historyScore, 15);
        const criteriaMet =
          (intentionScore > 0 ? 1 : 0) + (socialScore > 0 ? 1 : 0) +
          (mediaScore > 0 ? 1 : 0) + (historyScore > 0 ? 1 : 0);

        // Motor v3 — se IA não retornou métricas 0-100, deriva das métricas v2
        const historicalStrength = c.historicalStrength != null
          ? clamp(c.historicalStrength)
          : clamp((historyScore / 15) * 100);
        const politicalActivity = c.politicalActivity != null
          ? clamp(c.politicalActivity)
          : clamp((socialScore / 25) * 100);
        const socialSignal = c.socialSignal != null
          ? clamp(c.socialSignal)
          : clamp((socialScore / 25) * 100);
        const mediaSignal = c.mediaSignal != null
          ? clamp(c.mediaSignal)
          : clamp((mediaScore / 20) * 100);
        const candidacyIntent = c.candidacyIntent != null
          ? clamp(c.candidacyIntent)
          : clamp((intentionScore / 40) * 100);
        const presidentialChecks = c.presidentialChecks != null ? Math.max(0, Math.min(5, Number(c.presidentialChecks) || 0)) : 0;

        // Score ponderado v3 (0-100): 15/20/20/20/25
        const finalScore = clamp(
          historicalStrength * 0.15 +
          politicalActivity  * 0.20 +
          socialSignal       * 0.20 +
          mediaSignal        * 0.20 +
          candidacyIntent    * 0.25
        );

        return {
          nome: String(c.name).trim(),
          partido: c.party || null,
          cargo: c.role || cargo || null,
          estado: (c.state ? normalizeUf(c.state) : null) || (isPresidente ? null : (uf || null)),
          municipio: mun || null,
          confidence: finalScore,
          status: c.status || "emergente",
          reason: c.reason ? String(c.reason).slice(0, 300) : "",
          nationalRelevance: isPresidente ? nationalRelevance : undefined,
          electoralViability: isPresidente ? electoralViability : undefined,
          mentions: isPresidente ? mentions : undefined,
          engagement: isPresidente ? engagement : undefined,
          sentiment: isPresidente ? sentiment : undefined,
          intentionScore, socialScore, mediaScore, historyScore, criteriaMet,
          historicalStrength, politicalActivity, socialSignal, mediaSignal, candidacyIntent,
          presidentialChecks,
        };
      });
  } catch (e) { console.warn("[discovery] ai err", e); return []; }
}

// ---------- OUTPUT ----------
type Tier =
  | "declarado"       // 90-100
  | "muito_forte"     // 80-89
  | "forte"           // 70-79
  | "possivel"        // 60-69
  | "observacao"      // 45-59
  | "fraco"           // <45 (não deve aparecer)
  | "inelegivel";

const TIER_LABEL: Record<Tier, string> = {
  declarado: "🟣 Declarado",
  muito_forte: "🟢 Muito forte",
  forte: "🟡 Forte",
  possivel: "🟡 Possível",
  observacao: "⚪ Em observação",
  fraco: "Fraco",
  inelegivel: "🔴 Inelegível",
};

const SCORE_EXPLAINER =
  "Score de pré-candidatura IA calculado com base em: força eleitoral histórica (15%), atividade política recente (20%), sinais sociais (20%), presença na mídia (20%) e evidências concretas de intenção de candidatura (25%).";

const INELIGIBLE: Record<string, { until: string; reason: string }> = {
  "jair bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
  "jair messias bolsonaro": { until: "2030", reason: "Inelegível pelo TSE até 2030" },
};

function tierFromScore(score: number): Tier {
  if (score >= 90) return "declarado";
  if (score >= 80) return "muito_forte";
  if (score >= 70) return "forte";
  if (score >= 60) return "possivel";
  if (score >= 45) return "observacao";
  return "fraco";
}

function toRow(c: DiscoveredCandidate, fallbackCargo: string) {
  const isPresidente = canonicalCargoKey(fallbackCargo) === "presidente";
  const cargo = isPresidente
    ? "presidente"
    : (canonicalCargoKey(c.cargo) ?? canonicalCargoKey(fallbackCargo) ?? null);
  const inel = INELIGIBLE[normalizeName(c.nome)];
  const tier: Tier = inel ? "inelegivel" : tierFromScore(c.confidence);
  const estado = isPresidente ? null : c.estado;
  const municipio = isPresidente ? null : c.municipio;
  return {
    id: `ai:${normalizeName(c.nome)}:${(estado || "").toUpperCase()}:${(municipio || "").toLowerCase()}`,
    tse_id: null,
    nome: c.nome,
    nome_urna: null,
    partido_sigla: c.partido,
    partido_nome: null,
    numero_partido: null,
    cargo,
    regiao: null,
    estado,
    municipio,
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
    confidence_tier_label: TIER_LABEL[tier],
    score_breakdown: {
      historical_strength: c.historicalStrength ?? null,
      political_activity: c.politicalActivity ?? null,
      social_signal: c.socialSignal ?? null,
      media_signal: c.mediaSignal ?? null,
      candidacy_intent: c.candidacyIntent ?? null,
    },
    score_explainer: SCORE_EXPLAINER,
    is_eligible: !inel,
    ineligible_reason: inel?.reason ?? null,
    reason: c.reason || null,
  };
}

// Regras 3 e 5: âncoras de score presidencial e blocklist
const PRESIDENTE_BLOCKLIST = new Set<string>([
  "andre janones", "joao doria",
]);
const PRESIDENTE_SCORE_ANCHORS: Array<{ match: RegExp; min?: number; max?: number }> = [
  { match: /\blula\b/, min: 95 },
  { match: /\btarcisio\b/, min: 90 },
  { match: /\bbolsonaro\b/, min: 90 },
  { match: /\bcaiado\b/, min: 80 },
  { match: /\bzema\b/, min: 75 },
  { match: /\bratinho\b/, min: 75 },
  { match: /\bmichelle\b/, min: 75 },
  { match: /\beduardo leite\b/, min: 70 },
  { match: /\bhaddad\b/, max: 55 },
  { match: /\bdoria\b/, max: 30 },
];
function applyPresidenteAnchor(nome: string, score: number): number {
  const n = normalizeName(nome);
  for (const a of PRESIDENTE_SCORE_ANCHORS) {
    if (a.match.test(n)) {
      let s = score;
      if (a.min != null) s = Math.max(s, a.min);
      if (a.max != null) s = Math.min(s, a.max);
      return s;
    }
  }
  return score;
}

// ---------- DISCOVERY ENGINE ----------
async function discoverPoliticalActors(body: Body): Promise<any[]> {
  const cargo = normalizeCargo(body.cargo);
  const uf = firstValue(body.estado).toUpperCase();
  const mun = (body.municipio || "").trim();
  const isMunicipal = cargo === "prefeito" || cargo === "vereador";
  const isPresidente = cargo === "presidente";

  console.log("PRE_CANDIDATE_AI_START");
  console.log("CITY:", mun || "-");
  console.log("STATE:", uf || "-");
  console.log("CARGO:", cargo || "-");

  if (isMunicipal) {
    console.log("DISCOVERY MODE: MUNICIPAL_ENGINE");
    const includeAllMunicipalHistory = cargo === "prefeito";
    const history = await fetchMunicipalHistory(cargo, uf, mun, includeAllMunicipalHistory);
    const cityUniverse = await countMunicipalUniverse(uf, mun);
    const largeCity = cityUniverse >= 100;
    console.log("TSE_HISTORY_ROWS:", history.length);
    console.log("MUNICIPAL_UNIVERSE:", cityUniverse, "LARGE_CITY:", largeCity);

    if (!history.length) {
      console.log("FINAL IA RESULTS: 0 (sem histórico TSE municipal)");
      return [];
    }

    const queries = buildMunicipalEnrichmentQueries(cargo, uf, mun, history);
    console.log("SEARCH QUERIES:", queries);

    const hitLists = FIRECRAWL_API_KEY
      ? await Promise.all(queries.map((q) => firecrawlSearch(q, "qdr:m3", 6)))
      : [];
    const seenHits = new Set<string>();
    const hits: WebHit[] = [];
    for (const list of hitLists) for (const h of list) {
      const k = h.url || `${h.title}|${h.description}`;
      if (k && !seenHits.has(k)) { seenHits.add(k); hits.push(h); }
    }
    console.log("WEB_MATCHES:", hits.length);

    let discovered = await scoreMunicipalHistoricalActors(body, history, hits);
    console.log("EXTRACTED NAMES:", discovered.length);

    const dedup = new Map<string, DiscoveredCandidate>();
    for (const c of discovered) {
      const key = normalizeName(c.nome);
      if (!key) continue;
      const prev = dedup.get(key);
      if (!prev || c.confidence > prev.confidence) dedup.set(key, c);
    }
    discovered = Array.from(dedup.values()).filter((c) => c.confidence >= 50);

    if (discovered.length === 0 && largeCity) {
      console.log("MUNICIPAL_FALLBACK_START");
      discovered = buildMunicipalFallbackRows(body, history, 50);
    }

    for (const c of discovered) {
      console.log("PRE_CANDIDATE_AI", {
        name: c.nome,
        city: c.municipio,
        state: c.estado,
        cargo: c.cargo || cargo,
        WEB_MATCHES: hits.length,
        SOCIAL_MATCHES: c.socialScore ?? 0,
        MEDIA_MATCHES: c.localMediaScore ?? c.mediaScore ?? 0,
        TSE_HISTORY: c.continuityScore ?? c.historyScore ?? 0,
        POLITICAL_ENGAGEMENT: c.politicalEngagementScore ?? 0,
        FINAL_SCORE: c.confidence,
        status: c.confidence >= 50 ? "APPROVED" : "REJECTED (score<50)",
      });
    }

    const rows = discovered
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 50)
      .map((c) => toRow(c, cargo));
    console.log("FINAL IA RESULTS:", rows.length);
    return rows;
  }

  const queries = buildDiscoveryQueries(cargo, uf, mun);
  console.log("DISCOVERY MODE: MACRO_ENGINE");
  console.log("SEARCH QUERIES:", queries);

  if (!queries.length) { console.log("FINAL IA RESULTS: 0 (no queries)"); return []; }

  // Recência: municipais 90d, demais 180d
  const tbs = isMunicipal ? "qdr:m3" : "qdr:m6";
  const hitLists = FIRECRAWL_API_KEY
    ? await Promise.all(queries.map((q) => firecrawlSearch(q, tbs)))
    : [];
  const seen = new Set<string>();
  const hits: WebHit[] = [];
  for (const list of hitLists) for (const h of list) {
    const k = h.url || `${h.title}|${h.description}`;
    if (k && !seen.has(k)) { seen.add(k); hits.push(h); }
  }
  console.log("WEB_MATCHES:", hits.length);

  const discovered = await scorePoliticalActors(body, hits, queries);
  console.log("STEP 4 EXTRACTED NAMES", discovered.length);

  // Dedup
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

  const minScore = 45; // v3: abaixo de 45 nunca exibir

  // Penalidade de inelegibilidade
  const withPenalty = Array.from(dedup.values()).map((c) => {
    const inel = INELIGIBLE[normalizeName(c.nome)];
    if (inel) return { ...c, confidence: Math.round(c.confidence * 0.75) };
    return c;
  });

  // Filtro presidencial
  const relevanceFiltered = isPresidente
    ? withPenalty
        .filter((c) => {
          if (PRESIDENTE_BLOCKLIST.has(normalizeName(c.nome))) {
            console.log("[presidente] BLOCKLIST:", c.nome);
            return false;
          }
          return true;
        })
        .map((c) => ({ ...c, confidence: applyPresidenteAnchor(c.nome, c.confidence) }))
        .filter((c) => {
          // Regra v3 Presidente: exigir >=2 checkboxes presidenciais
          const checks = c.presidentialChecks ?? 0;
          const nr = c.nationalRelevance ?? 0;
          const passesChecks = checks >= 2;
          const passesRelevance = nr >= 60;
          if (!passesChecks && !passesRelevance) {
            console.log("[presidente] EXCLUÍDO:", c.nome, "checks=", checks, "NR=", nr);
            return false;
          }
          return true;
        })
    : withPenalty;

  // Debug por candidato + regras v3
  const approved: DiscoveredCandidate[] = [];
  for (const c of relevanceFiltered) {
    const cm = c.criteriaMet ?? 0;
    const nameToks = (c.nome || "").trim().split(/\s+/).length;
    const generic = isGenericName(c.nome);
    const intent = c.candidacyIntent ?? 0;
    const mediaSig = c.mediaSignal ?? 0;
    const strongEvidence = intent >= 30 || (c.mediaScore ?? 0) >= 15;

    let approvedFlag = true;
    let rejectReason = "";

    // Regra anti-falso-positivo v3: candidacy_intent<20 AND media<20 → IGNORAR
    if (intent < 20 && mediaSig < 20) {
      approvedFlag = false; rejectReason = "low_intent (intent<20 && media<20)";
    }
    else if (nameToks < 2) { approvedFlag = false; rejectReason = "nome incompleto"; }
    else if (c.confidence < minScore) { approvedFlag = false; rejectReason = `score<${minScore}`; }
    else if (isMunicipal && cm < 2) { approvedFlag = false; rejectReason = "municipal exige >=2 critérios"; }
    else if (generic && !strongEvidence) { approvedFlag = false; rejectReason = "nome genérico sem evidência forte"; }

    if (!approvedFlag) {
      console.log("IGNORED_PRE_CANDIDATE", { name: c.nome, reason: rejectReason });
    }

    console.log("AI CANDIDATE ANALYSIS", {
      name: c.nome,
      cargo: c.cargo || cargo,
      city: c.municipio,
      state: c.estado,
      historical_strength: c.historicalStrength,
      political_activity: c.politicalActivity,
      social_signal: c.socialSignal,
      media_signal: c.mediaSignal,
      candidacy_intent: c.candidacyIntent,
      presidential_checks: c.presidentialChecks ?? 0,
      final_score: c.confidence,
      ignored_reason: approvedFlag ? null : rejectReason,
    });

    console.log("PRE_CANDIDATE_AI", {
      name: c.nome,
      city: c.municipio,
      state: c.estado,
      cargo: c.cargo || cargo,
      WEB_MATCHES: hits.length,
      SOCIAL_MATCHES: c.socialScore,
      MEDIA_MATCHES: c.mediaScore,
      TSE_HISTORY: c.historyScore,
      INTENTION: c.intentionScore,
      criteriaMet: cm,
      FINAL_SCORE: c.confidence,
      status: approvedFlag ? "APPROVED" : `REJECTED (${rejectReason})`,
    });

    if (approvedFlag) approved.push(c);
  }

  if (isPresidente) {
    for (const c of approved) {
      console.log("PRESIDENTIAL SCORE", {
        name: c.nome, mentions: c.mentions, engagement: c.engagement,
        sentiment: c.sentiment, nationalRelevance: c.nationalRelevance,
        electoralViability: c.electoralViability, finalScore: c.confidence,
      });
    }
  }

  const rows = approved
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, isPresidente ? 12 : 50)
    .map((c) => toRow(c, cargo));

  console.log("FINAL IA RESULTS:", rows.length);
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
      const isMunicipal = cargo === "prefeito" || cargo === "vereador";
      const message = aiRows.length === 0
        ? isMunicipal
          ? "Não encontramos pré-candidatos com sinais políticos confiáveis nesta região no momento."
          : "Não encontramos sinais políticos suficientes na web para esse filtro."
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
        sources: aiRows.length ? [isMunicipal ? "ai_municipal_tse" : "ai_web"] : [],
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
