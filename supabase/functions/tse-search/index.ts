// Catálogo Político — busca REAL via API oficial TSE (divulgacandcontas)
// Fonte: https://divulgacandcontas.tse.jus.br/divulga/rest/v1
// Sem IA gerando candidatos. Sem mock. Sem hardcoded. Dados oficiais paginados.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PAGE_SIZE = 50;
const TSE_BASE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

// Códigos de cargo conforme TSE
const CARGO_TO_TSE: Record<string, number> = {
  presidente: 1, vice_presidente: 2,
  governador: 3, vice_governador: 4,
  senador: 5, deputado_federal: 6, deputado_estadual: 7, deputado_distrital: 8,
  prefeito: 11, vice_prefeito: 12, vereador: 13,
};

const CARGO_LABEL: Record<string, string> = {
  presidente: "Presidente da República", vice_presidente: "Vice-presidente",
  governador: "Governador", vice_governador: "Vice-governador",
  senador: "Senador", deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual", deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito", vice_prefeito: "Vice-prefeito", vereador: "Vereador",
};

const MUNICIPAL_CARGOS = new Set(["prefeito", "vice_prefeito", "vereador"]);
const FEDERAL_BR_CARGOS = new Set(["presidente", "vice_presidente"]);

// Eleições oficiais
// 2024 municipal 1º turno = 619, 2º turno = 620
// 2022 federal/estadual 1º turno = 544, 2º turno = 545
const ELEICAO_MUN_2024 = 619;
const ELEICAO_FED_2022 = 544;

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const UF_DICT: Record<string, string> = {
  "acre":"AC","alagoas":"AL","amapa":"AP","amazonas":"AM","bahia":"BA","ceara":"CE",
  "distrito federal":"DF","df":"DF","espirito santo":"ES","goias":"GO","maranhao":"MA",
  "mato grosso":"MT","mato grosso do sul":"MS","minas gerais":"MG","para":"PA",
  "paraiba":"PB","parana":"PR","pernambuco":"PE","piaui":"PI","rio de janeiro":"RJ",
  "rio grande do norte":"RN","rio grande do sul":"RS","rondonia":"RO","roraima":"RR",
  "santa catarina":"SC","sao paulo":"SP","sergipe":"SE","tocantins":"TO",
};
for (const uf of UFS) UF_DICT[uf.toLowerCase()] = uf;

function normalize(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function resolveUF(raw: unknown): string | null {
  if (!raw) return null;
  const n = normalize(raw).replace(/\./g, "");
  if (UF_DICT[n]) return UF_DICT[n];
  for (const part of n.split(/[\s,\-\/]+/)) if (UF_DICT[part]) return UF_DICT[part];
  return null;
}

function normalizeCargoKey(raw: string): string | null {
  const n = normalize(raw).replace(/[^a-z ]/g, "").replace(/\s+/g, "_");
  if (CARGO_TO_TSE[n]) return n;
  const aliases: Record<string, string> = {
    "vice": "vice_presidente",
    "presidente_da_republica": "presidente",
    "deputado": "deputado_federal",
  };
  return aliases[n] ?? null;
}

interface Filters {
  q: string | null;
  cargos: string[];
  partidos: string[];
  ufs: string[];
  municipio: string | null;
  onlyEleitos: boolean;
  page: number;
}

async function readFilters(req: Request): Promise<Filters> {
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { /* noop */ } }
  const get = (k: string) => body[k] ?? url.searchParams.get(k);
  const csv = (v: string | null | undefined) => v ? String(v).split(",").map((x) => x.trim()).filter(Boolean) : [];
  const arr = (k: string) => Array.isArray(body[k]) ? body[k] as string[] : csv(url.searchParams.get(k));

  const cargosRaw = arr("cargo");
  const cargos = cargosRaw.map((c) => normalizeCargoKey(c)).filter((c): c is string => !!c);

  return {
    q: (get("q") as string | null)?.trim() || null,
    cargos,
    partidos: arr("partido").map((p) => p.toUpperCase()),
    ufs: arr("estado").map((u) => resolveUF(u) ?? "").filter(Boolean),
    municipio: (get("municipio") as string | null)?.trim() || null,
    onlyEleitos: String(get("somenteEleitos") ?? get("onlyEleitos") ?? "") === "true" || body.onlyEleitos === true,
    page: Math.max(0, Number(get("page") ?? 0)),
  };
}

interface TseCandidato {
  id?: number;
  sqCandidato?: number;
  nomeUrna?: string;
  nomeCompleto?: string;
  nm?: string;
  nmU?: string;
  cargo?: { codigo?: number; nome?: string };
  partido?: { sigla?: string; numero?: number; nome?: string };
  numero?: number;
  descricaoSituacao?: string;
  st?: string; // status abreviado
  fotoUrl?: string;
  st_eleicao?: string;
}

async function tseFetch<T>(path: string): Promise<T | null> {
  const url = `${TSE_BASE}${path}`;
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 ClimaPolitico/1.0",
        "Accept": "application/json",
        "Referer": "https://divulgacandcontas.tse.jus.br/",
      },
    });
    if (!r.ok) { console.log(`[tse] ${path} → HTTP ${r.status}`); return null; }
    return await r.json() as T;
  } catch (e) {
    console.error(`[tse] ${path} fetch error:`, e);
    return null;
  }
}

// Lista municípios de uma UF para um ano de eleição
async function listMunicipios(ano: number, cdEleicao: number, uf: string): Promise<Array<{ codigo: number; nome: string }>> {
  const data = await tseFetch<any>(`/eleicao/buscar/${ano}/${cdEleicao}/${uf}/municipios`);
  const arr = data?.municipios ?? data ?? [];
  return Array.isArray(arr) ? arr.map((m: any) => ({ codigo: Number(m.codigo ?? m.cdMunicipio), nome: String(m.nome ?? m.nm) })) : [];
}

// Busca candidatos de um cargo num escopo (município ou UF/BR)
async function fetchCandidatos(ano: number, escopo: string | number, cdEleicao: number, cargoCodigo: number): Promise<TseCandidato[]> {
  const data = await tseFetch<any>(`/candidatura/listar/${ano}/${escopo}/${cdEleicao}/${cargoCodigo}/candidatos`);
  const list = data?.candidatos ?? data ?? [];
  return Array.isArray(list) ? list : [];
}

function statusFromTse(desc: string | undefined): { label: string; eleito: boolean; categoria: string } {
  const n = normalize(desc ?? "");
  if (n.includes("eleito") || n === "el") return { label: "Eleito", eleito: true, categoria: "eleito" };
  if (n.includes("nao eleito") || n.includes("não eleito") || n === "ne" || n === "nelei") return { label: "Não eleito", eleito: false, categoria: "ex_candidato" };
  if (n.includes("suplente")) return { label: "Suplente", eleito: false, categoria: "ex_candidato" };
  if (n.includes("indef") || n.includes("renunc") || n.includes("cassad")) return { label: "Inválido", eleito: false, categoria: "ex_candidato" };
  return { label: "Candidato", eleito: false, categoria: "ex_candidato" };
}

interface OutRow {
  id: string; tse_id: string | null; nome: string; nome_urna: string | null;
  partido_sigla: string | null; partido_nome: string | null; numero_partido: string | null;
  cargo: string | null; regiao: null; estado: string | null; municipio: string | null;
  eleito: boolean; categoria: string; ano_eleicao: number | null;
  foto_url: string | null; redes_sociais: null; popularidade: number; similarity: number; total_count: number;
}

function mapCandidato(c: any, cargoKey: string, uf: string | null, municipio: string | null, ano: number): OutRow | null {
  const nome = c.nomeCompleto ?? c.nm ?? c.nomeUrna ?? c.nmU;
  if (!nome) return null;
  const nomeUrna = c.nomeUrna ?? c.nmU ?? null;
  const sq = c.sqCandidato ?? c.id ?? c.sq ?? null;
  const partidoSigla = c.partido?.sigla ?? c.sgPartido ?? null;
  const partidoNumero = c.partido?.numero ?? c.nrPartido ?? null;
  const partidoNome = c.partido?.nome ?? c.nmPartido ?? null;
  const desc = c.descricaoSituacao ?? c.descricaoSituacaoCandidato ?? c.dsSit ?? c.st ?? "";
  const st = statusFromTse(desc);
  return {
    id: `tse-${ano}-${sq ?? `${nome}-${uf ?? ""}-${municipio ?? ""}`}`,
    tse_id: sq ? String(sq) : null,
    nome: String(nome),
    nome_urna: nomeUrna ? String(nomeUrna) : null,
    partido_sigla: partidoSigla ? String(partidoSigla).toUpperCase() : null,
    partido_nome: partidoNome ? String(partidoNome) : null,
    numero_partido: partidoNumero != null ? String(partidoNumero) : null,
    cargo: cargoKey,
    regiao: null,
    estado: uf,
    municipio: municipio,
    eleito: st.eleito,
    categoria: st.categoria,
    ano_eleicao: ano,
    foto_url: c.fotoUrl ?? null,
    redes_sociais: null,
    popularidade: st.eleito ? 1 : 0.5,
    similarity: 1,
    total_count: 0,
  };
}

// Concorrência limitada
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Resolve um cargo num escopo (uf+municipio?) → lista de candidatos
async function searchCargo(cargoKey: string, f: Filters): Promise<OutRow[]> {
  const cargoCodigo = CARGO_TO_TSE[cargoKey];
  if (!cargoCodigo) return [];
  const isMun = MUNICIPAL_CARGOS.has(cargoKey);
  const isBR = FEDERAL_BR_CARGOS.has(cargoKey);
  const ano = isMun ? 2024 : 2022;
  const cdEleicao = isMun ? ELEICAO_MUN_2024 : ELEICAO_FED_2022;
  const out: OutRow[] = [];

  if (isBR) {
    const list = await fetchCandidatos(ano, "BR", cdEleicao, cargoCodigo);
    console.log(`[tse] presidente/vice → ${list.length} candidatos`);
    for (const c of list) {
      const r = mapCandidato(c, cargoKey, null, null, ano);
      if (r) out.push(r);
    }
    return out;
  }

  const ufsTarget = f.ufs.length > 0 ? f.ufs : (isMun ? [] : UFS);
  if (isMun && ufsTarget.length === 0) {
    // Sem UF + municipal: muito amplo, pedir filtro
    throw new Error("Para cargos municipais (prefeito/vereador), informe ao menos um estado.");
  }

  for (const uf of ufsTarget) {
    if (isMun) {
      const municipios = await listMunicipios(ano, cdEleicao, uf);
      console.log(`[tse] ${uf} → ${municipios.length} municípios`);
      let alvo = municipios;
      if (f.municipio) {
        const n = normalize(f.municipio);
        alvo = municipios.filter((m) => normalize(m.nome).includes(n));
        console.log(`[tse] filtro município "${f.municipio}" → ${alvo.length} matches`);
      }
      // Limite de segurança: se >120 municípios e sem filtro, abortar para não estourar timeout
      if (alvo.length > 120) {
        throw new Error(`UF ${uf} tem ${alvo.length} municípios — refine pelo município para evitar timeout.`);
      }
      const lists = await mapWithLimit(alvo, 8, async (m) => {
        const list = await fetchCandidatos(ano, m.codigo, cdEleicao, cargoCodigo);
        return list.map((c) => mapCandidato(c, cargoKey, uf, m.nome, ano)).filter((r): r is OutRow => !!r);
      });
      for (const sub of lists) out.push(...sub);
    } else {
      // Estadual/federal por UF: o escopo é a sigla da UF
      const list = await fetchCandidatos(ano, uf, cdEleicao, cargoCodigo);
      console.log(`[tse] ${uf} ${cargoKey} → ${list.length} candidatos`);
      for (const c of list) {
        const r = mapCandidato(c, cargoKey, uf, null, ano);
        if (r) out.push(r);
      }
    }
  }
  return out;
}

function dedupe(rows: OutRow[]): OutRow[] {
  const seen = new Map<string, OutRow>();
  for (const r of rows) {
    const key = `${r.tse_id ?? normalize(r.nome)}|${r.cargo}|${r.estado ?? ""}|${r.municipio ?? ""}`;
    const prev = seen.get(key);
    if (!prev || (r.eleito && !prev.eleito)) seen.set(key, r);
  }
  return [...seen.values()];
}

function applyFilters(rows: OutRow[], f: Filters): OutRow[] {
  const q = normalize(f.q);
  return rows.filter((r) => {
    if (f.onlyEleitos && !r.eleito) return false;
    if (f.partidos.length && !f.partidos.includes((r.partido_sigla ?? "").toUpperCase())) return false;
    if (q) {
      const hay = normalize(`${r.nome} ${r.nome_urna ?? ""}`);
      if (!hay.includes(q)) {
        // fuzzy leve: todas as palavras do query precisam aparecer
        const tokens = q.split(/\s+/).filter(Boolean);
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
    }
    return true;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const f = await readFilters(req);
    console.log("FILTROS:", JSON.stringify(f));

    if (f.cargos.length === 0) {
      throw new Error("Selecione ao menos um cargo (Presidente, Governador, Senador, Deputado, Prefeito, Vereador...).");
    }

    const all: OutRow[] = [];
    for (const cargo of f.cargos) {
      console.log(`SOURCE: TSE divulgacandcontas | cargo=${cargo}`);
      const rows = await searchCargo(cargo, f);
      console.log(`RAW RESULTS (${cargo}): ${rows.length}`);
      all.push(...rows);
    }

    const deduped = dedupe(all);
    const filtered = applyFilters(deduped, f);
    console.log(`NORMALIZED: ${deduped.length} | FINAL COUNT: ${filtered.length}`);

    const total = filtered.length;
    const start = f.page * PAGE_SIZE;
    const paged = filtered.slice(start, start + PAGE_SIZE).map((r) => ({ ...r, total_count: total }));

    return new Response(JSON.stringify({
      rows: paged,
      total,
      hasMore: total > (f.page + 1) * PAGE_SIZE,
      exactTotal: true,
      suggestions: [],
      normalized: {},
      page: f.page,
      pageSize: PAGE_SIZE,
      fallback: false,
      notice: paged.length === 0
        ? "Nenhum candidato encontrado nos registros oficiais do TSE."
        : `Dados oficiais do TSE — ${total} candidato(s) encontrado(s).`,
      last_updated: new Date().toISOString(),
      source: "tse.divulgacandcontas",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[tse-search] FAIL:", msg);
    return new Response(JSON.stringify({
      fallback: true, error: msg, message: msg, notice: msg,
      rows: [], total: 0, hasMore: false, exactTotal: true,
      suggestions: [], normalized: {}, page: 0, pageSize: PAGE_SIZE,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
