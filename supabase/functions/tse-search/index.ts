// Real-time political catalog via public sources.
// 2026 candidacies are used only when officially published; otherwise use live public officeholder sources.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const WIKIDATA_SPARQL = "https://query.wikidata.org/sparql";
const TARGET_YEAR = 2026;

// Cargo code per TSE
const CARGO_CODE: Record<string, number> = {
  presidente: 1,
  vice_presidente: 2,
  governador: 3,
  vice_governador: 4,
  senador: 5,
  deputado_federal: 6,
  deputado_estadual: 7,
  deputado_distrital: 8,
  prefeito: 11,
  vice_prefeito: 12,
  vereador: 13,
};

const FEDERAL_CARGOS = new Set(["presidente", "vice_presidente", "governador", "vice_governador", "senador", "deputado_federal", "deputado_estadual", "deputado_distrital"]);
const MUNICIPAL_CARGOS = new Set(["prefeito", "vice_prefeito", "vereador"]);
const ELECTORAL_CARGOS = [...FEDERAL_CARGOS, ...MUNICIPAL_CARGOS];

const REGION_OF_UF: Record<string, string> = {
  AC: "norte", AM: "norte", AP: "norte", PA: "norte", RO: "norte", RR: "norte", TO: "norte",
  AL: "nordeste", BA: "nordeste", CE: "nordeste", MA: "nordeste", PB: "nordeste", PE: "nordeste", PI: "nordeste", RN: "nordeste", SE: "nordeste",
  DF: "centro-oeste", GO: "centro-oeste", MT: "centro-oeste", MS: "centro-oeste",
  ES: "sudeste", MG: "sudeste", RJ: "sudeste", SP: "sudeste",
  PR: "sul", RS: "sul", SC: "sul",
};

const UF_OF_REGION: Record<string, string[]> = {
  norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "centro-oeste": ["DF", "GO", "MT", "MS"],
  "centro oeste": ["DF", "GO", "MT", "MS"],
  sudeste: ["ES", "MG", "RJ", "SP"],
  sul: ["PR", "RS", "SC"],
};

const PAGE_SIZE = 50;
const TSE_REQUEST_TIMEOUT_MS = 12_000;

const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
const CEREBRAS_MODEL = "llama-3.3-70b";

// Cargos que o TSE de candidaturas NÃO cobre — sempre via base auxiliar/IA 2026.
const AI_ONLY_CARGOS = new Set(["ministro", "presidente_partido", "pre_candidato"]);

const normalize = (str: string | null | undefined) =>
  String(str ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();

const stripAccents = normalize;

const CARGO_ALIASES: Record<string, string> = {
  presidente: "presidente",
  "vice presidente": "vice_presidente",
  vicepresidente: "vice_presidente",
  governador: "governador",
  "vice governador": "vice_governador",
  vicegovernador: "vice_governador",
  senador: "senador",
  "deputada federal": "deputado_federal",
  "deputado federal": "deputado_federal",
  "deputada estadual": "deputado_estadual",
  "deputado estadual": "deputado_estadual",
  "deputada distrital": "deputado_distrital",
  "deputado distrital": "deputado_distrital",
  prefeito: "prefeito",
  prefeita: "prefeito",
  "vice prefeito": "vice_prefeito",
  "vice prefeita": "vice_prefeito",
  viceprefeito: "vice_prefeito",
  viceprefeita: "vice_prefeito",
  vereador: "vereador",
  vereadora: "vereador",
  ministro: "ministro",
  ministra: "ministro",
  "presidente de partido": "presidente_partido",
  "presidente partidario": "presidente_partido",
  "pre candidato": "pre_candidato",
  "pre candidata": "pre_candidato",
  precandidato: "pre_candidato",
};

function normalizeCargoKey(value: string): string | null {
  if (CARGO_CODE[value]) return value;
  if (AI_ONLY_CARGOS.has(value)) return value;
  const n = normalize(value);
  return CARGO_ALIASES[n] ?? (AI_ONLY_CARGOS.has(n) ? n : null);
}

async function tseJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TSE_REQUEST_TIMEOUT_MS);
  const r = await fetch(url, {
    signal: controller.signal,
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
  }).finally(() => clearTimeout(timeout));
  if (!r.ok) throw new Error(`TSE ${r.status} ${url}`);
  return r.json();
}

function escapeSparqlString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ");
}

async function wikidataSparql(query: string) {
  const url = `${WIKIDATA_SPARQL}?${new URLSearchParams({ format: "json", query }).toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TSE_REQUEST_TIMEOUT_MS);
  const r = await fetch(url, {
    signal: controller.signal,
    headers: {
      Accept: "application/sparql-results+json, application/json",
      "User-Agent": "ClimaPolitico/1.0 political-catalog",
    },
  }).finally(() => clearTimeout(timeout));
  if (!r.ok) throw new Error(`Wikidata ${r.status}`);
  return r.json();
}

interface TseElection {
  id: number;
  ano: number;
  nomeEleicao: string;
  tipoAbrangencia: "F" | "M" | string;
  dataEleicao?: string | null;
}

const electionsCache = new Map<string, { at: number; rows: TseElection[] }>();

async function getOrdinaryElections(): Promise<TseElection[]> {
  const cached = electionsCache.get("ordinarias");
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.rows;
  try {
    const rows = (await tseJson(`${TSE}/eleicao/ordinarias`)) as TseElection[];
    electionsCache.set("ordinarias", { at: Date.now(), rows });
    return rows;
  } catch (e) {
    console.error("[tse-search] elections discovery failed:", e);
    // Últimas eleições oficiais conhecidas; usadas somente quando o endpoint de descoberta falha.
    return [
      { id: 2045202024, ano: 2024, nomeEleicao: "Eleições Municipais 2024", tipoAbrangencia: "M" },
      { id: 2040602022, ano: 2022, nomeEleicao: "Eleição Geral Federal 2022", tipoAbrangencia: "F" },
    ];
  }
}

async function resolveElection(kind: "F" | "M") {
  // Foco 2026: só usar eleição oficial se for do ano-alvo. Sem fallback para 2022/2024.
  const rows = (await getOrdinaryElections())
    .filter((e) => e.tipoAbrangencia === kind && Number(e.ano) === TARGET_YEAR)
    .sort((a, b) => Number(b.id) - Number(a.id));
  const election = rows[0];
  if (!election) return null;
  return {
    id: Number(election.id),
    ano: Number(election.ano),
    name: election.nomeEleicao,
    isTargetYear: true,
  };
}

async function resolvePublishedElectionsBeforeTarget(kind: "F" | "M", maxCount = 1) {
  const rows = (await getOrdinaryElections())
    .filter((e) => e.tipoAbrangencia === kind && Number(e.ano) < TARGET_YEAR)
    .sort((a, b) => {
      const yearDiff = Number(b.ano) - Number(a.ano);
      return yearDiff !== 0 ? yearDiff : Number(b.id) - Number(a.id);
    });

  return rows.slice(0, maxCount).map((e) => ({
    id: Number(e.id),
    ano: Number(e.ano),
    name: e.nomeEleicao,
  }));
}


const municipiosCache = new Map<string, Array<{ codigo: string; nome: string; normalized: string }>>();

type MunicipioTse = { codigo: string; nome: string; normalized: string };

async function getMunicipios(uf: string, idEleicao: number): Promise<MunicipioTse[]> {
  const key = `${uf}-${idEleicao}`;
  if (municipiosCache.has(key)) return municipiosCache.get(key)!;
  try {
    const j = await tseJson(`${TSE}/eleicao/buscar/${uf}/${idEleicao}/municipios`);
    const list = (j.municipios ?? []).map((m: any) => ({
      codigo: String(m.codigo ?? m.cdMunicipio),
      nome: String(m.nome ?? m.nmMunicipio),
      normalized: stripAccents(String(m.nome ?? m.nmMunicipio)),
    }));
    municipiosCache.set(key, list);
    return list;
  } catch {
    return [];
  }
}

interface CandidateOut {
  id: string;
  tse_id: string | null;
  nome: string;
  nome_urna: string | null;
  partido_sigla: string | null;
  partido_nome: string | null;
  numero_partido: string | null;
  cargo: string | null;
  regiao: string | null;
  estado: string | null;
  municipio: string | null;
  eleito: boolean;
  categoria: "eleito" | "ex_candidato" | "pre_candidato" | "lideranca_local" | null;
  ano_eleicao: number | null;
  foto_url: string | null;
  redes_sociais: Record<string, string> | null;
  popularidade: number;
  similarity: number;
  total_count: number;
}

const cargoKeyFromCode = (n: number): string =>
  Object.entries(CARGO_CODE).find(([, v]) => v === n)?.[0] ?? String(n);

function mapCandidate(raw: any, ctx: { uf: string; municipio: string | null; ano: number; idEleicao: number; ueCode: string }): CandidateOut {
  const sq = String(raw.id ?? raw.sqCandidato ?? "");
  const desc = [
    raw.descricaoSituacao,
    raw.desSituacaoCandidatura,
    raw.descricaoTotalizacao,
    raw.descSituacaoTotalizacao,
    raw.situacaoTotalizacao,
  ].filter(Boolean).join(" ").toString().toLowerCase();
  const cargoCode = Number(raw.cargo?.codigo ?? raw.cdCargo ?? 0);
  const cargoKey = cargoKeyFromCode(cargoCode);
  const eleito = /eleito|eleita|reeleito|reeleita/.test(desc) && !/n[ãa]o eleito|suplente/.test(desc);
  return {
    id: sq || crypto.randomUUID(),
    tse_id: sq || null,
    nome: raw.nomeCompleto ?? raw.nomeUrna ?? raw.nm ?? "",
    nome_urna: raw.nomeUrna ?? null,
    partido_sigla: raw.partido?.sigla ?? raw.sgPartido ?? null,
    partido_nome: raw.partido?.nome ?? raw.nmPartido ?? null,
    numero_partido: raw.numero ? String(raw.numero) : (raw.nrCandidato ? String(raw.nrCandidato) : null),
    cargo: cargoKey,
    regiao: REGION_OF_UF[ctx.uf] ?? null,
    estado: ctx.uf,
    municipio: ctx.municipio,
    eleito,
    categoria: eleito ? "eleito" : "ex_candidato",
    ano_eleicao: ctx.ano,
    foto_url: sq ? `https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/${ctx.idEleicao}/${ctx.ueCode}/${sq}.jpeg` : null,
    redes_sociais: null,
    popularidade: 0,
    similarity: 1,
    total_count: 0,
  };
}

type TSEFetchResult = { rows: CandidateOut[]; failed: boolean };

async function fetchFederal(uf: string, cargoKey: string, election: { id: number; ano: number }): Promise<TSEFetchResult> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return { rows: [], failed: false };
  const ueCode = cargoKey === "presidente" || cargoKey === "vice_presidente" ? "BR" : uf;
  const url = `${TSE}/candidatura/listar/${election.ano}/${ueCode}/${election.id}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return { rows: list.map((c) => mapCandidate(c, { uf: ueCode === "BR" ? "BR" : uf, municipio: null, ano: election.ano, idEleicao: election.id, ueCode })), failed: false };
  } catch (e) {
    console.error("[tse-search] federal fetch failed:", e);
    return { rows: [], failed: true };
  }
}

async function fetchMunicipalByCode(uf: string, municipio: { codigo: string; nome: string }, cargoKey: string, election: { id: number; ano: number }): Promise<TSEFetchResult> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return { rows: [], failed: false };
  const url = `${TSE}/candidatura/listar/${election.ano}/${municipio.codigo}/${election.id}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return { rows: list.map((c) => mapCandidate(c, { uf, municipio: municipio.nome, ano: election.ano, idEleicao: election.id, ueCode: municipio.codigo })), failed: false };
  } catch (e) {
    console.error("[tse-search] municipal fetch failed:", e);
    return { rows: [], failed: true };
  }
}

async function resolveMunicipiosForUf(uf: string, municipioNome: string | null | undefined, election: { id: number }): Promise<MunicipioTse[]> {
  const munis = await getMunicipios(uf, election.id);
  if (!municipioNome) return munis;
  const target = stripAccents(municipioNome);
  const muni = munis.find((m: MunicipioTse) => m.normalized === target) ?? munis.find((m: MunicipioTse) => m.normalized.includes(target));
  return muni ? [muni] : [];
}

interface Filters {
  q?: string | null;
  cargo?: string[] | null;
  partido?: string[] | null;
  regiao?: string[] | null;
  estado?: string[] | null;
  municipio?: string | null;
  onlyEleitos?: boolean;
  page?: number;
}

function csvParam(value: string | null): string[] | null {
  if (!value) return null;
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

async function readFilters(req: Request): Promise<Filters> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    return {
      q: url.searchParams.get("name") ?? url.searchParams.get("q"),
      cargo: csvParam(url.searchParams.get("cargo")),
      partido: csvParam(url.searchParams.get("partido")),
      regiao: csvParam(url.searchParams.get("regiao")),
      estado: csvParam(url.searchParams.get("estado")),
      municipio: url.searchParams.get("municipio"),
      onlyEleitos: ["1", "true", "sim"].includes(normalize(url.searchParams.get("somenteEleitos") ?? url.searchParams.get("onlyEleitos"))),
      page: Number(url.searchParams.get("page") ?? 0),
    };
  }

  return await req.json().catch(() => ({}));
}

function resolveUfs(f: Filters): string[] {
  if (f.estado?.length) return f.estado.map((u) => u.toUpperCase());
  if (f.regiao?.length) return f.regiao.flatMap((r) => UF_OF_REGION[normalize(r)] ?? []);
  return Object.keys(REGION_OF_UF);
}

function resolveCargos(f: Filters): string[] {
  if (f.cargo?.length) return [...new Set(f.cargo.map((c) => normalizeCargoKey(c)).filter(Boolean))] as string[];
  // Sem cargo: todos os cargos eleitorais + cargos políticos vivos cobertos por base auxiliar.
  return [...ELECTORAL_CARGOS, ...AI_ONLY_CARGOS];
}

const CARGO_LABEL: Record<string, string> = {
  presidente: "Presidente da República",
  vice_presidente: "Vice-presidente",
  governador: "Governador",
  vice_governador: "Vice-governador",
  senador: "Senador",
  deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual",
  deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito",
  vice_prefeito: "Vice-prefeito",
  vereador: "Vereador",
  ministro: "Ministro de Estado",
  presidente_partido: "Presidente Nacional de Partido",
  pre_candidato: "Pré-candidato 2026",
};

function scoreTextSimilarity(a: string, b: string) {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa.includes(bb) || bb.includes(aa)) return 1;
  const words = bb.split(" ").filter(Boolean);
  if (words.length > 1 && words.every((w) => aa.includes(w))) return 0.92;
  const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const ga = grams(aa);
  const gb = grams(bb);
  if (!ga.size || !gb.size) return 0;
  let overlap = 0;
  gb.forEach((g) => { if (ga.has(g)) overlap += 1; });
  return (2 * overlap) / (ga.size + gb.size);
}

function matchesClientFilters(c: CandidateOut, f: Filters) {
  if (f.cargo?.length) {
    const set = new Set(f.cargo.map((cargo) => normalizeCargoKey(cargo) ?? normalize(cargo)));
    const candidateCargo = c.cargo ? (normalizeCargoKey(c.cargo) ?? normalize(c.cargo)) : null;
    if (!candidateCargo || !set.has(candidateCargo)) return false;
  }
  if (f.estado?.length) {
    const set = new Set(f.estado.map((uf) => uf.toUpperCase()));
    if (!c.estado || !set.has(c.estado.toUpperCase())) return false;
  }
  if (f.regiao?.length) {
    const set = new Set(f.regiao.map((r) => normalize(r)));
    if (!c.regiao || !set.has(normalize(c.regiao))) return false;
  }
  if (f.municipio && normalize(c.municipio) !== normalize(f.municipio)) return false;
  if (f.partido?.length) {
    const set = new Set(f.partido.map((p) => normalize(p)));
    if (!c.partido_sigla || !set.has(normalize(c.partido_sigla))) return false;
  }
  if (f.q) {
    const haystack = `${c.nome} ${c.nome_urna ?? ""}`;
    if (scoreTextSimilarity(haystack, f.q) < 0.58) return false;
  }
  if (f.onlyEleitos && !c.eleito) return false;
  return true;
}

function pickSourcesForCargos(cargos: string[]): string[] {
  const s = new Set<string>();
  for (const c of cargos) {
    if (c === "vereador" || c === "prefeito" || c === "vice_prefeito") {
      s.add("Prefeitura municipal (site oficial)");
      s.add("Câmara Municipal (site oficial)");
      s.add("TRE do estado");
      s.add("Diário Oficial do Município");
    } else if (c === "deputado_federal" || c === "senador" || c === "presidente" || c === "vice_presidente") {
      s.add("Câmara dos Deputados (camara.leg.br)");
      s.add("Senado Federal (senado.leg.br)");
      s.add("TSE / DivulgaCandContas");
    } else if (c === "governador" || c === "vice_governador" || c === "deputado_estadual" || c === "deputado_distrital") {
      s.add("Assembleia Legislativa estadual / Câmara Distrital");
      s.add("Governo do estado (site oficial)");
      s.add("TSE / DivulgaCandContas");
    } else if (c === "ministro") {
      s.add("gov.br / Casa Civil");
    } else if (c === "presidente_partido") {
      s.add("Site oficial do partido / TSE registro de diretórios");
    } else if (c === "pre_candidato") {
      s.add("Imprensa nacional e regional (Folha, G1, Estadão, UOL)");
    }
  }
  return [...s];
}

async function aiPoliticalLookup(f: Filters, cargos: string[], rawCandidates: CandidateOut[]): Promise<{ rows: CandidateOut[]; error: string | null }> {
  if (!CEREBRAS_API_KEY) {
    console.warn("[tse-search] AI lookup skipped: CEREBRAS_API_KEY missing");
    return { rows: rawCandidates, error: "CEREBRAS_API_KEY ausente" };
  }
  if (rawCandidates.length === 0) {
    return { rows: [], error: null };
  }
  const cargoNames = cargos.map((c) => CARGO_LABEL[c] ?? c).join(", ");
  const ufs = (f.estado ?? []).join(", ");
  const partidos = (f.partido ?? []).join(", ");
  const municipio = f.municipio ?? "";
  const nome = f.q ?? "";
  console.log("Calling Cerebras matching engine", { model: CEREBRAS_MODEL, candidates: rawCandidates.length });
  console.log("Source used:", "cerebras");

  const system = `Você é um motor de matching político brasileiro.

Receberá:
- filtros do usuário
- candidatos brutos vindos de fontes públicas

Tarefas:
1. Corrigir erros ortográficos
2. Normalizar acentos
3. Aplicar matching semântico
4. Rankear resultados por relevância
5. Nunca inventar candidatos — use SOMENTE nomes que aparecem na lista de candidatos brutos.

Retornar APENAS JSON no formato:
{"resultados":[{"nome":"","cargo":"","partido":"","estado":"","cidade":"","score":0}]}

score: 0-100 (relevância em relação aos filtros).
Devolva todos os candidatos compatíveis ordenados por score decrescente. Não invente cargos, partidos ou cidades — copie dos candidatos brutos.`;

  const compactCandidates = rawCandidates.slice(0, 200).map((c, i) => ({
    i,
    nome: c.nome,
    cargo: c.cargo,
    partido: c.partido_sigla,
    estado: c.estado,
    cidade: c.municipio,
  }));

  const user = `Filtros do usuário:
- nome contém: ${nome || "(qualquer)"}
- cargos: ${cargoNames || "qualquer"}
- estados (UF): ${ufs || "qualquer"}
- partidos: ${partidos || "qualquer"}
- município: ${municipio || "qualquer"}
- somente eleitos: ${f.onlyEleitos ? "sim" : "não"}

Candidatos brutos (fontes públicas TSE/Wikidata):
${JSON.stringify(compactCandidates)}`;

  try {
    const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CEREBRAS_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 4000,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error("External results: [] — Cerebras failed:", r.status, body);
      // Fallback: devolve dados brutos filtrados sem ranking IA.
      return {
        rows: rawCandidates,
        error: r.status === 429
          ? "Cerebras com limite de uso. Mostrando dados brutos sem ranking."
          : `Cerebras indisponível (HTTP ${r.status}). Mostrando dados brutos sem ranking.`,
      };
    }
    const j = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
    const list: any[] = parsed?.resultados ?? parsed?.politicos ?? [];
    console.log("Cerebras results:", { raw: list.length });

    // Mapear de volta para os candidatos brutos (Cerebras NÃO inventa: usa apenas nomes existentes).
    const byKey = new Map<string, CandidateOut>();
    for (const c of rawCandidates) {
      byKey.set(`${normalize(c.nome)}|${c.estado ?? ""}|${normalize(c.municipio)}`, c);
    }
    const ranked: CandidateOut[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      const key = `${normalize(p.nome)}|${(p.estado ?? "").toUpperCase()}|${normalize(p.cidade)}`;
      const match = byKey.get(key)
        ?? rawCandidates.find((c) => normalize(c.nome) === normalize(p.nome));
      if (!match) continue;
      const dedup = `${normalize(match.nome)}|${match.cargo ?? ""}|${match.estado ?? ""}|${normalize(match.municipio)}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      const score = Number(p.score ?? 50) / 100;
      ranked.push({ ...match, similarity: score, popularidade: score });
    }

    const mapped = ranked.filter((row) => matchesClientFilters(row, f));
    // Se Cerebras descartou tudo mas há dados brutos válidos, devolve os brutos como fallback.
    if (mapped.length === 0 && rawCandidates.length > 0) {
      return { rows: rawCandidates.filter((row) => matchesClientFilters(row, f)), error: null };
    }
    return { rows: mapped, error: null };
  } catch (error) {
    console.error("Search error", error);
    return {
      rows: rawCandidates,
      error: error instanceof Error ? `Cerebras: ${error.message}` : "Falha no matching IA",
    };
  }
}

function cargoFromOfficeLabel(label: string | null | undefined) {
  const n = normalize(label);
  if (n.includes("vice presidente")) return "vice_presidente";
  if (n.includes("presidente do brasil") || n.includes("presidente da republica")) return "presidente";
  if (n.includes("governador")) return "governador";
  if (n.includes("senador")) return "senador";
  if (n.includes("camara dos deputados") || n.includes("deputado federal")) return "deputado_federal";
  if (n.includes("deputado estadual")) return "deputado_estadual";
  if (n.includes("deputado distrital")) return "deputado_distrital";
  if (n.includes("prefeito")) return "prefeito";
  if (n.includes("vereador")) return "vereador";
  if (n.includes("ministro")) return "ministro";
  return "pre_candidato";
}

function getBindingValue(binding: Record<string, any>, key: string): string | null {
  return binding?.[key]?.value ? String(binding[key].value) : null;
}

function rowFromWikidata(binding: Record<string, any>, idx: number, fallbackCargo: string | null): CandidateOut | null {
  const name = getBindingValue(binding, "personLabel") ?? getBindingValue(binding, "ptLabel");
  if (!name) return null;
  const partyShort = getBindingValue(binding, "partyShort");
  const partyName = getBindingValue(binding, "partyLabel");
  const office = getBindingValue(binding, "officeLabel");
  const state = getBindingValue(binding, "stateUf");
  const cargo = fallbackCargo ?? cargoFromOfficeLabel(office);
  return {
    id: `wikidata-${idx}-${normalize(name).replace(/\s+/g, "-")}`,
    tse_id: null,
    nome: name,
    nome_urna: null,
    partido_sigla: partyShort && normalize(partyShort).length <= 12 ? partyShort.toUpperCase() : null,
    partido_nome: partyName,
    numero_partido: null,
    cargo,
    regiao: state ? (REGION_OF_UF[state.toUpperCase()] ?? null) : null,
    estado: state ? state.toUpperCase() : null,
    municipio: null,
    eleito: cargo !== "pre_candidato",
    ano_eleicao: null,
    foto_url: null,
    redes_sociais: null,
    popularidade: 0.72,
    similarity: 0.72,
    total_count: 0,
  };
}

async function wikidataAuxiliaryLookup(f: Filters, cargos: string[]): Promise<CandidateOut[]> {
  const rows: CandidateOut[] = [];
  const wantsPartyPresident = cargos.includes("presidente_partido");
  const q = normalize(f.q);
  const rawQ = String(f.q ?? "").trim().toLowerCase();
  const labelFilter = q
    ? `FILTER(CONTAINS(LCASE(STR(?ptLabel)), "${escapeSparqlString(rawQ)}") || CONTAINS(LCASE(STR(?ptLabel)), "${escapeSparqlString(q)}"))`
    : "";

  try {
    if (wantsPartyPresident) {
      const query = `
SELECT ?person ?personLabel ?ptLabel ?partyLabel ?partyShort WHERE {
  ?party wdt:P31/wdt:P279* wd:Q7278; wdt:P17 wd:Q155; wdt:P488 ?person.
  ?person rdfs:label ?ptLabel FILTER(LANG(?ptLabel) = "pt").
  ${labelFilter}
  OPTIONAL { ?party wdt:P1813 ?partyShort. FILTER(LANG(?partyShort) = "pt" || LANG(?partyShort) = "" || LANG(?partyShort) = "und") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
} LIMIT 50`;
      const data = await wikidataSparql(query);
      for (const [idx, binding] of ((data?.results?.bindings ?? []) as any[]).entries()) {
        const row = rowFromWikidata(binding, idx, "presidente_partido");
        if (row && matchesClientFilters(row, f)) rows.push(row);
      }
    }

    if (q && rows.length < PAGE_SIZE) {
      const query = `
SELECT ?person ?personLabel ?ptLabel ?officeLabel ?partyLabel ?partyShort WHERE {
  ?person wdt:P27 wd:Q155; rdfs:label ?ptLabel.
  FILTER(LANG(?ptLabel) = "pt")
  ${labelFilter}
  { ?person wdt:P106/wdt:P279* wd:Q82955. } UNION { ?person wdt:P39 ?office. }
  OPTIONAL { ?person wdt:P39 ?office. }
  OPTIONAL { ?person wdt:P102 ?party. OPTIONAL { ?party wdt:P1813 ?partyShort. FILTER(LANG(?partyShort) = "pt" || LANG(?partyShort) = "" || LANG(?partyShort) = "und") } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
} LIMIT 50`;
      const data = await wikidataSparql(query);
      for (const [idx, binding] of ((data?.results?.bindings ?? []) as any[]).entries()) {
        const row = rowFromWikidata(binding, idx + rows.length, null);
        if (row && cargos.includes(row.cargo ?? "") && matchesClientFilters(row, f)) rows.push(row);
      }
    }
  } catch (e) {
    console.error("[tse-search] Wikidata auxiliary lookup failed:", e);
  }

  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${normalize(row.nome)}|${row.cargo ?? ""}|${row.partido_sigla ?? row.partido_nome ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, PAGE_SIZE);
}

type FetchTask =
  | { kind: "federal"; uf: string; cargo: string }
  | { kind: "municipal"; uf: string; municipio: { codigo: string; nome: string }; cargo: string };

function asPoliticalLiveRow(row: CandidateOut, sourceYear: number): CandidateOut {
  return {
    ...row,
    id: `political-live-2026-${sourceYear}-${row.id}`,
    ano_eleicao: null,
    popularidade: Math.max(row.popularidade, 0.86),
    similarity: Math.max(row.similarity, 0.86),
  };
}

function isCurrentMandateRow(row: CandidateOut) {
  return row.eleito === true;
}

async function politicalLiveBaseLookup(f: Filters, cargos: string[], ufs: string[]): Promise<{ rows: CandidateOut[]; sources: string[]; failed: number }> {
  const rows: CandidateOut[] = [];
  const sources = new Set<string>();
  let failed = 0;
  const municipalCargos = cargos.filter((c) => MUNICIPAL_CARGOS.has(c));
  const federalCargos = cargos.filter((c) => FEDERAL_CARGOS.has(c));

  if (municipalCargos.length > 0 && f.municipio) {
    const [municipalElection] = await resolvePublishedElectionsBeforeTarget("M", 1);
    if (municipalElection) {
      sources.add(`political_live_2026:tse_${municipalElection.ano}_municipal_elected`);
      const targetUfs = ufs.filter((uf) => uf !== "BR");
      const municipalLists = await Promise.all(targetUfs.map(async (uf) => ({
        uf,
        municipios: await resolveMunicipiosForUf(uf, f.municipio, municipalElection),
      })));

      for (const { uf, municipios } of municipalLists) {
        for (const municipio of municipios) {
          for (const cargo of municipalCargos) {
            const result = await fetchMunicipalByCode(uf, municipio, cargo, municipalElection);
            if (result.failed) failed += 1;
            rows.push(...result.rows.filter(isCurrentMandateRow).map((row) => asPoliticalLiveRow(row, municipalElection.ano)));
          }
        }
      }
    }
  }

  if (f.municipio) {
    return { rows: rows.filter((row) => matchesClientFilters(row, f)), sources: [...sources], failed };
  }

  if (federalCargos.length > 0) {
    const needsSenators = federalCargos.includes("senador");
    const federalElections = await resolvePublishedElectionsBeforeTarget("F", needsSenators ? 2 : 1);

    for (const election of federalElections) {
      const cargosForElection = federalCargos.filter((cargo) => {
        if (cargo === "senador") return election.ano >= TARGET_YEAR - 8;
        return election.ano === federalElections[0]?.ano;
      });
      if (cargosForElection.length === 0) continue;
      sources.add(`political_live_2026:tse_${election.ano}_federal_elected`);

      for (const cargo of cargosForElection) {
        const targetUfs = (cargo === "presidente" || cargo === "vice_presidente") ? ["BR"] : ufs.filter((uf) => uf !== "BR");
        for (const uf of targetUfs) {
          const result = await fetchFederal(uf, cargo, election);
          if (result.failed) failed += 1;
          rows.push(...result.rows.filter(isCurrentMandateRow).map((row) => asPoliticalLiveRow(row, election.ano)));
        }
      }
    }
  }

  const seen = new Set<string>();
  const filtered = rows.filter((row) => {
    if (!matchesClientFilters(row, f)) return false;
    const key = `${normalize(row.nome)}|${row.cargo ?? ""}|${row.estado ?? ""}|${normalize(row.municipio)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { rows: filtered, sources: [...sources], failed };
}

async function buildTasks(f: Filters, cargos: string[], ufs: string[], elections: { federal: { id: number; ano: number } | null; municipal: { id: number; ano: number } | null }) {
  const tasks: FetchTask[] = [];
  const federalCargos = elections.federal ? cargos.filter((c) => FEDERAL_CARGOS.has(c)) : [];
  const municipalCargos = elections.municipal ? cargos.filter((c) => MUNICIPAL_CARGOS.has(c)) : [];

  if (elections.federal) {
    for (const cargo of federalCargos) {
      const targetUfs = (cargo === "presidente" || cargo === "vice_presidente") ? ["BR"] : ufs;
      for (const uf of targetUfs) tasks.push({ kind: "federal", uf, cargo });
    }
  }

  if (elections.municipal && municipalCargos.length > 0) {
    const targetUfs = ufs.filter((uf) => uf !== "BR");
    const municipalLists = await Promise.all(targetUfs.map(async (uf) => ({ uf, municipios: await resolveMunicipiosForUf(uf, f.municipio, elections.municipal!) })));
    for (const { uf, municipios } of municipalLists) {
      for (const municipio of municipios) {
        for (const cargo of municipalCargos) tasks.push({ kind: "municipal", uf, municipio, cargo });
      }
    }
  }

  return tasks;
}


async function executePagedTseSearch(f: Filters, tasks: FetchTask[], elections: { federal: { id: number; ano: number } | null; municipal: { id: number; ano: number } | null }) {
  const page = Math.max(0, Number(f.page ?? 0));
  const offset = page * PAGE_SIZE;
  let skipped = 0;
  let attempted = 0;
  let failed = 0;
  let exhausted = true;
  const collected: CandidateOut[] = [];
  const seen = new Set<string>();

  for (const task of tasks) {
    attempted += 1;
    const result = task.kind === "federal"
      ? await fetchFederal(task.uf, task.cargo, elections.federal!)
      : await fetchMunicipalByCode(task.uf, task.municipio, task.cargo, elections.municipal!);
    if (result.failed) failed += 1;

    for (const row of result.rows) {
      if (!matchesClientFilters(row, f)) continue;
      const key = `${row.tse_id ?? normalize(row.nome)}|${row.estado ?? ""}|${row.municipio ?? ""}|${row.cargo ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      collected.push(row);
      if (collected.length > PAGE_SIZE) {
        exhausted = false;
        break;
      }
    }
    if (!exhausted) break;
  }

  const hasMore = collected.length > PAGE_SIZE || !exhausted;
  const rows = collected.slice(0, PAGE_SIZE);
  const exactTotal = exhausted;
  const total = exactTotal ? offset + rows.length : offset + rows.length + PAGE_SIZE;
  return { rows, total, exactTotal, hasMore, attempted, failed };
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const f = await readFilters(req);
    console.log("Search Filters", {
      nome: f.q ?? null,
      cargo: f.cargo ?? null,
      partido: f.partido ?? null,
      regiao: f.regiao ?? null,
      estado: f.estado ?? null,
      cidade: f.municipio ?? null,
    });
    console.log("[tse-search] filters:", JSON.stringify(f));

    const cargos = resolveCargos(f);
    const ufs = resolveUfs(f);
    const page = Math.max(0, Number(f.page ?? 0));

    if (f.cargo?.length && cargos.length === 0) {
      return new Response(JSON.stringify({
        rows: [],
        total: 0,
        suggestions: [],
        normalized: {},
        page: f.page ?? 0,
        notice: "Cargo não reconhecido.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const [federalElection, municipalElection] = await Promise.all([resolveElection("F"), resolveElection("M")]);
    const elections = { federal: federalElection, municipal: municipalElection };
    const tse2026Available = !!(federalElection || municipalElection);
    const tasks = await buildTasks(f, cargos, ufs, elections);
    const tsePage = await executePagedTseSearch(f, tasks, elections);
    const tseFailed = tasks.length > 0 && tsePage.failed === tsePage.attempted;
    console.log(`[tse-search] TSE 2026 Results ${tsePage.rows.length} via ${tsePage.attempted} reqs (failed=${tsePage.failed}, hasMore=${tsePage.hasMore}, available=${tse2026Available})`);

    // 2026: se o TSE ainda não publicou candidaturas oficiais, usar base política viva.
    const liveCargos = f.cargo?.length ? cargos : [...new Set([...cargos, ...AI_ONLY_CARGOS])];
    const shouldUsePoliticalLiveBase = TARGET_YEAR === 2026 && (!tse2026Available || tsePage.rows.length === 0 || tseFailed);
    const liveBase = shouldUsePoliticalLiveBase
      ? await politicalLiveBaseLookup(f, liveCargos, ufs)
      : { rows: [] as CandidateOut[], sources: [] as string[], failed: 0 };

    console.log({
      city: f.municipio ?? null,
      year: TARGET_YEAR,
      source: shouldUsePoliticalLiveBase ? liveBase.sources.join("+") || "political_live_2026" : "tse_2026_candidates",
      results: shouldUsePoliticalLiveBase ? liveBase.rows.length : tsePage.rows.length,
    });

    // Etapa 1: coletar dados brutos de fontes públicas (TSE + Wikidata).
    const auxiliaryRows = page === 0 ? await wikidataAuxiliaryLookup(f, liveCargos) : [];

    // Etapa 2: enviar dados brutos para Cerebras fazer matching/ranking/dedup.
    // Cerebras NÃO inventa candidatos — só rankeia o que veio das fontes públicas.
    const rawPool = [...liveBase.rows, ...tsePage.rows, ...auxiliaryRows];
    const aiResult = page === 0
      ? await aiPoliticalLookup(f, liveCargos, rawPool)
      : { rows: rawPool as CandidateOut[], error: null as string | null };

    const aiRows = aiResult.rows;
    const aiError = aiResult.error;

    const sourceUsed = {
      ai: aiRows.length,
      aiError,
      politicalLiveBase: liveBase.rows.length,
      politicalLiveSources: liveBase.sources,
      wikidata: auxiliaryRows.length,
      tse: tsePage.rows.length,
      tse2026Available,
    };

    // Dedup por (nome|cargo|estado|municipio) — aiRows já vem rankeado pelo Cerebras.
    const seen = new Set<string>();
    const dedupKey = (c: CandidateOut) => `${normalize(c.nome)}|${c.cargo ?? ""}|${c.estado ?? ""}|${normalize(c.municipio)}`;
    const pool = aiRows.filter((c) => {
      const k = dedupKey(c);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Filtro estrito determinístico
    const afterStrictFilter = pool.filter((candidate) => matchesClientFilters(candidate, f));
    const offset = shouldUsePoliticalLiveBase ? page * PAGE_SIZE : 0;
    const merged = afterStrictFilter.slice(offset, offset + PAGE_SIZE);
    const hasMore = shouldUsePoliticalLiveBase
      ? afterStrictFilter.length > offset + PAGE_SIZE
      : afterStrictFilter.length > PAGE_SIZE || tsePage.hasMore;
    const exactTotal = shouldUsePoliticalLiveBase || afterStrictFilter.length > 0;
    const total = exactTotal ? afterStrictFilter.length : page * PAGE_SIZE + merged.length + (hasMore ? PAGE_SIZE : 0);
    const rows = merged.map((r) => ({ ...r, total_count: total }));

    console.log({
      filters: f,
      sourceUsed,
      resultsCount: rows.length,
      poolBeforeFilter: pool.length,
      poolAfterFilter: afterStrictFilter.length,
    });

    if (rows.length === 0) {
      const notice = aiError
        ? `Não foi possível consultar a base política agora: ${aiError}`
        : "Nenhum candidato encontrado.";
      return new Response(JSON.stringify({
        rows: [],
        total: 0,
        hasMore: false,
        exactTotal: true,
        suggestions: [],
        normalized: {},
        page,
        pageSize: PAGE_SIZE,
        fallback: !!aiError,
        sourceUsed,
        notice,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      rows,
      total,
      hasMore,
      exactTotal,
      suggestions: [],
      normalized: {},
      page,
      pageSize: PAGE_SIZE,
      fallback: false,
      sourceUsed,
      notice: null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[tse-search] error:", e);
    return new Response(JSON.stringify({
      fallback: true,
      error: "SERVICE_FAILED",
      message: "Não foi possível consultar a base política agora.",
      rows: [],
      total: 0,
      suggestions: [],
      normalized: {},
      page: 0,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
