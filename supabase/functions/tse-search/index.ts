// Real-time TSE search via DivulgaCandContas public API.
// No local catalog, no mock. Each request hits TSE directly.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TSE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

// Election IDs
const ID_ELEICAO_FEDERAL_2022 = 545; // Eleições Gerais 2022
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
  sudeste: ["ES", "MG", "RJ", "SP"],
  sul: ["PR", "RS", "SC"],
};

const PAGE_SIZE = 50;

const stripAccents = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

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

async function fetchFederal(uf: string, cargoKey: string): Promise<CandidateOut[]> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return [];
  const ueCode = cargoKey === "presidente" || cargoKey === "vice_presidente" ? "BR" : uf;
  const url = `${TSE}/candidatura/listar/2022/${ueCode}/${ID_ELEICAO_FEDERAL_2022}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return list.map((c) => mapCandidate(c, { uf, municipio: null, ano: 2022, idEleicao: ID_ELEICAO_FEDERAL_2022, ueCode }));
  } catch (e) {
    console.error("[tse-search] federal fetch failed:", e);
    return [];
  }
}

async function fetchMunicipal(uf: string, municipioNome: string, cargoKey: string): Promise<CandidateOut[]> {
  const code = CARGO_CODE[cargoKey];
  if (!code) return [];
  const munis = await getMunicipios(uf, ID_ELEICAO_MUNICIPAL_2024);
  const target = stripAccents(municipioNome);
  const muni = munis.find((m) => m.normalized === target) ?? munis.find((m) => m.normalized.includes(target));
  if (!muni) return [];
  const url = `${TSE}/candidatura/listar/2024/${muni.codigo}/${ID_ELEICAO_MUNICIPAL_2024}/${code}/candidatos`;
  try {
    const j = await tseJson(url);
    const list: any[] = j.candidatos ?? [];
    return list.map((c) => mapCandidate(c, { uf, municipio: muni.nome, ano: 2024, idEleicao: ID_ELEICAO_MUNICIPAL_2024, ueCode: muni.codigo }));
  } catch (e) {
    console.error("[tse-search] municipal fetch failed:", e);
    return [];
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

function resolveUfs(f: Filters): string[] {
  if (f.estado?.length) return f.estado.map((u) => u.toUpperCase());
  if (f.regiao?.length) return f.regiao.flatMap((r) => UF_OF_REGION[r] ?? []);
  return Object.keys(REGION_OF_UF);
}

function resolveCargos(f: Filters): string[] {
  if (f.cargo?.length) return f.cargo;
  // Without cargo: default to the top federal cargos to keep request bounded.
  return ["presidente", "governador", "senador", "deputado_federal"];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const f: Filters = await req.json().catch(() => ({}));
    console.log("[tse-search] filters:", JSON.stringify(f));

    const cargos = resolveCargos(f);
    const ufs = resolveUfs(f);
    const wantsMunicipal = cargos.some((c) => MUNICIPAL_CARGOS.has(c));

    // Municipal requires UF + município
    if (wantsMunicipal && (!f.estado?.length || !f.municipio)) {
      return new Response(JSON.stringify({
        rows: [],
        total: 0,
        suggestions: [],
        normalized: {},
        page: f.page ?? 0,
        notice: "Para cargos municipais (prefeito, vice, vereador), informe Estado e Município.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Limit fan-out for federal queries when no UF chosen + no presidential
    const federalCargos = cargos.filter((c) => FEDERAL_CARGOS.has(c));
    const municipalCargos = cargos.filter((c) => MUNICIPAL_CARGOS.has(c));

    const tasks: Promise<CandidateOut[]>[] = [];

    for (const cargo of federalCargos) {
      const targetUfs = (cargo === "presidente" || cargo === "vice_presidente") ? ["BR"] : ufs;
      for (const uf of targetUfs) tasks.push(fetchFederal(uf, cargo));
    }
    for (const cargo of municipalCargos) {
      for (const uf of (f.estado ?? []).map((u) => u.toUpperCase())) {
        tasks.push(fetchMunicipal(uf, f.municipio!, cargo));
      }
    }

    const results = (await Promise.all(tasks)).flat();
    console.log(`[tse-search] tse returned ${results.length} candidates across ${tasks.length} requests`);

    // Client-side filters
    let filtered = results;
    if (f.partido?.length) {
      const set = new Set(f.partido.map((p) => p.toUpperCase()));
      filtered = filtered.filter((c) => c.partido_sigla && set.has(c.partido_sigla.toUpperCase()));
    }
    if (f.q) {
      const q = stripAccents(f.q);
      filtered = filtered.filter((c) =>
        stripAccents(c.nome).includes(q) || (c.nome_urna && stripAccents(c.nome_urna).includes(q))
      );
    }
    if (f.onlyEleitos) filtered = filtered.filter((c) => c.eleito);

    const total = filtered.length;
    const page = Math.max(0, Number(f.page ?? 0));
    const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map((r) => ({ ...r, total_count: total }));

    console.log(`[tse-search] returning ${rows.length}/${total} (page ${page})`);

    return new Response(JSON.stringify({
      rows, total, suggestions: [], normalized: {}, page,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[tse-search] error:", e);
    return new Response(JSON.stringify({ error: String(e), rows: [], total: 0, suggestions: [] }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
