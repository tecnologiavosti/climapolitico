// Real-time TSE search via DivulgaCandContas public API.
// No local catalog, no mock. Each request hits TSE directly.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

// Election IDs
// 544 = 1º turno das Eleições Gerais 2022. 545 é 2º turno e retorna listas vazias
// para vários cargos, inclusive Presidente/Vice-presidente.
const ID_ELEICAO_FEDERAL_2022 = 544;
const ID_ELEICAO_MUNICIPAL_2024 = 619; // Eleições Municipais 2024

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

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

// Cargos que o TSE histórico (2022/2024) NÃO cobre — sempre via IA 2026.
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
  const r = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`TSE ${r.status} ${url}`);
  return r.json();
}

const municipiosCache = new Map<string, Array<{ codigo: string; nome: string; normalized: string }>>();

async function getMunicipios(uf: string, idEleicao: number) {
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
  const desc = (raw.descricaoSituacao ?? raw.desSituacaoCandidatura ?? "").toString().toLowerCase();
  const cargoCode = Number(raw.cargo?.codigo ?? raw.cdCargo ?? 0);
  const cargoKey = cargoKeyFromCode(cargoCode);
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
    eleito: /eleito|reeleito/.test(desc) && !/n[ãa]o eleito/.test(desc),
    ano_eleicao: ctx.ano,
    foto_url: sq ? `https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/${ctx.idEleicao}/${ctx.ueCode}/${sq}.jpeg` : null,
    redes_sociais: null,
    popularidade: 0,
    similarity: 1,
    total_count: 0,
  };
}

type TSEFetchResult = { rows: CandidateOut[]; failed: boolean };

async function fetchFederal(uf: string, cargoKey: string): Promise<TSEFetchResult> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return { rows: [], failed: false };
  const ueCode = cargoKey === "presidente" || cargoKey === "vice_presidente" ? "BR" : uf;
  const url = `${TSE}/candidatura/listar/2022/${ueCode}/${ID_ELEICAO_FEDERAL_2022}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return { rows: list.map((c) => mapCandidate(c, { uf, municipio: null, ano: 2022, idEleicao: ID_ELEICAO_FEDERAL_2022, ueCode })), failed: false };
  } catch (e) {
    console.error("[tse-search] federal fetch failed:", e);
    return { rows: [], failed: true };
  }
}

async function fetchMunicipal(uf: string, municipioNome: string, cargoKey: string): Promise<TSEFetchResult> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return { rows: [], failed: false };
  const munis = await getMunicipios(uf, ID_ELEICAO_MUNICIPAL_2024);
  const target = stripAccents(municipioNome);
  const muni = munis.find((m) => m.normalized === target) ?? munis.find((m) => m.normalized.includes(target));
  if (!muni) return { rows: [], failed: false };
  const url = `${TSE}/candidatura/listar/2024/${muni.codigo}/${ID_ELEICAO_MUNICIPAL_2024}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return { rows: list.map((c) => mapCandidate(c, { uf, municipio: muni.nome, ano: 2024, idEleicao: ID_ELEICAO_MUNICIPAL_2024, ueCode: muni.codigo })), failed: false };
  } catch (e) {
    console.error("[tse-search] municipal fetch failed:", e);
    return { rows: [], failed: true };
  }
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
  // Without cargo: default to top federal cargos + cargos vivos 2026 cobertos pela IA.
  return ["presidente", "governador", "senador", "deputado_federal", "ministro", "presidente_partido"];
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

async function aiPoliticalLookup(f: Filters, cargos: string[]): Promise<CandidateOut[]> {
  if (!LOVABLE_API_KEY) return [];
  const cargoNames = cargos.map((c) => CARGO_LABEL[c] ?? c).join(", ");
  const ufs = (f.estado ?? []).join(", ");
  const partidos = (f.partido ?? []).join(", ");
  const municipio = f.municipio ?? "";
  const nome = f.q ?? "";

  const system = `Você é um especialista no cenário político brasileiro atual (2025-2026).
Conhece presidente, vice, ministros, governadores, vice-governadores, senadores, deputados federais/estaduais/distritais, prefeitos, vice-prefeitos, vereadores em exercício, presidentes nacionais de partidos e pré-candidatos declarados para 2026.
Inclui figuras como Lula, Bolsonaro, Tarcísio de Freitas, Ratinho Júnior, Ronaldo Caiado, Romeu Zema, Pablo Marçal, Flávio Bolsonaro, Nikolas Ferreira, Gustavo Martinelli e equivalentes.
Devolva APENAS JSON: {"politicos":[{"nome":"...","partido":"SIGLA","cargo":"presidente|vice_presidente|governador|vice_governador|senador|deputado_federal|deputado_estadual|deputado_distrital|prefeito|vice_prefeito|vereador|ministro|presidente_partido|pre_candidato","estado":"UF","municipio":"...|null","eleito":true|false,"confidence":0-1}]}.
Máximo 30 itens. Só políticos REAIS e atuais. Nunca invente nomes.`;

  const user = `Busca:
- nome contém: ${nome || "(qualquer)"}
- cargos: ${cargoNames || "qualquer"}
- estados (UF): ${ufs || "qualquer"}
- partidos: ${partidos || "qualquer"}
- município: ${municipio || "qualquer"}
- somente eleitos/em exercício: ${f.onlyEleitos ? "sim" : "não"}`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      console.error("[tse-search] AI lookup failed:", r.status, await r.text().catch(() => ""));
      return [];
    }
    const j = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
    const list: any[] = parsed?.politicos ?? [];
    return list.map((p, i) => ({
      id: `ai-${i}-${normalize(p.nome).replace(/\s+/g, "-")}`,
      tse_id: null,
      nome: String(p.nome ?? ""),
      nome_urna: null,
      partido_sigla: p.partido ? String(p.partido).toUpperCase() : null,
      partido_nome: null,
      numero_partido: null,
      cargo: normalizeCargoKey(String(p.cargo ?? "")) ?? String(p.cargo ?? null),
      regiao: p.estado ? (REGION_OF_UF[String(p.estado).toUpperCase()] ?? null) : null,
      estado: p.estado ? String(p.estado).toUpperCase() : null,
      municipio: p.municipio ?? null,
      eleito: !!p.eleito,
      ano_eleicao: null,
      foto_url: null,
      redes_sociais: null,
      popularidade: Number(p.confidence ?? 0.5),
      similarity: Number(p.confidence ?? 0.5),
      total_count: 0,
    } satisfies CandidateOut));
  } catch (e) {
    console.error("[tse-search] AI lookup exception:", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const f = await readFilters(req);
    console.log("[tse-search] filters:", JSON.stringify(f));

    const cargos = resolveCargos(f);
    const ufs = resolveUfs(f);
    const wantsMunicipal = cargos.some((c) => MUNICIPAL_CARGOS.has(c));

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

    // Limit fan-out for federal queries when no UF chosen + no presidential
    const federalCargos = cargos.filter((c) => FEDERAL_CARGOS.has(c));
    const municipalCargos = cargos.filter((c) => MUNICIPAL_CARGOS.has(c));
    const aiOnlyCargos = cargos.filter((c) => AI_ONLY_CARGOS.has(c));
    // Municipal requires UF + município (apenas se TSE municipal foi solicitado)
    const municipalReady = !wantsMunicipal || (f.estado?.length && f.municipio);

    const tasks: Promise<TSEFetchResult>[] = [];

    for (const cargo of federalCargos) {
      const targetUfs = (cargo === "presidente" || cargo === "vice_presidente") ? ["BR"] : ufs;
      for (const uf of targetUfs) tasks.push(fetchFederal(uf, cargo));
    }
    if (municipalReady) {
      for (const cargo of municipalCargos) {
        for (const uf of (f.estado ?? []).map((u) => u.toUpperCase())) {
          tasks.push(fetchMunicipal(uf, f.municipio!, cargo));
        }
      }
    }

    const fetched = await Promise.all(tasks);
    const tseResults = fetched.flatMap((r) => r.rows);
    const failedRequests = fetched.filter((r) => r.failed).length;
    const tseFailed = tasks.length > 0 && failedRequests === tasks.length;
    console.log(`[tse-search] tse returned ${tseResults.length} via ${tasks.length} reqs (failed=${failedRequests})`);

    // Client-side filters em TSE
    let filteredTse = tseResults;
    if (f.partido?.length) {
      const set = new Set(f.partido.map((p) => normalize(p)));
      filteredTse = filteredTse.filter((c) => c.partido_sigla && set.has(normalize(c.partido_sigla)));
    }
    if (f.q) {
      const q = stripAccents(f.q);
      filteredTse = filteredTse.filter((c) =>
        stripAccents(c.nome).includes(q) || (c.nome_urna && stripAccents(c.nome_urna).includes(q))
      );
    }
    if (f.onlyEleitos) filteredTse = filteredTse.filter((c) => c.eleito);

    // IA 2026: complementa quando TSE vazio, cargos AI-only, busca por nome sem hit, ou municipal sem UF/município
    const needAi =
      aiOnlyCargos.length > 0 ||
      filteredTse.length === 0 ||
      (!!f.q && filteredTse.length < 5) ||
      (wantsMunicipal && !municipalReady) ||
      tseFailed;

    let aiRows: CandidateOut[] = [];
    if (needAi) {
      const aiCargos = [...new Set([...cargos, ...aiOnlyCargos])];
      aiRows = await aiPoliticalLookup(f, aiCargos);
      // dedupe por nome+UF
      const seen = new Set(filteredTse.map((c) => `${normalize(c.nome)}|${c.estado ?? ""}`));
      aiRows = aiRows.filter((c) => {
        const k = `${normalize(c.nome)}|${c.estado ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      console.log(`[tse-search] AI 2026 added ${aiRows.length} profiles`);
    }

    const merged = [...filteredTse, ...aiRows];
    const total = merged.length;
    const page = Math.max(0, Number(f.page ?? 0));
    const rows = merged.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map((r) => ({ ...r, total_count: total }));

    if (total === 0 && tseFailed) {
      return new Response(JSON.stringify({
        fallback: true,
        error: "TSE_SERVICE_UNAVAILABLE",
        message: "Não foi possível consultar base do TSE agora.",
        rows: [], total: 0, suggestions: [], normalized: {}, page,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log(`[tse-search] returning ${rows.length}/${total} (page ${page}, ai=${aiRows.length})`);

    return new Response(JSON.stringify({
      rows, total, suggestions: [], normalized: {}, page, fallback: false,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[tse-search] error:", e);
    return new Response(JSON.stringify({
      fallback: true,
      error: "SERVICE_FAILED",
      message: "Não foi possível consultar base do TSE agora.",
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
