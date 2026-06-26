// Catálogo Político 2026 — Crawler estruturado multi-fonte
// Camada 1: TSE oficial (divulgacandcontas) 2024 municipal + 2022 federal/estadual
// Camada 2: Firecrawl search (Wikipedia, G1, UOL, sites oficiais) p/ cargos não-TSE e nomes livres
// Camada 3: Cerebras (somente normalização/dedupe semântica/correção ortográfica). NUNCA gera candidatos.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";

// ============ CONSTANTES ============
const PAGE_SIZE = 50;
const TSE_BASE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";

const SOFT_TIMEOUT_MS = 55_000; // antes do limite de 60s do edge
const TSE_CONCURRENCY = 10;

const CARGO_TO_TSE: Record<string, number> = {
  presidente: 1, vice_presidente: 2,
  governador: 3, vice_governador: 4,
  senador: 5, deputado_federal: 6, deputado_estadual: 7, deputado_distrital: 8,
  prefeito: 11, vice_prefeito: 12, vereador: 13,
};

const CARGO_LABEL: Record<string, string> = {
  presidente: "Presidente", vice_presidente: "Vice-presidente",
  governador: "Governador", vice_governador: "Vice-governador",
  senador: "Senador", deputado_federal: "Deputado Federal",
  deputado_estadual: "Deputado Estadual", deputado_distrital: "Deputado Distrital",
  prefeito: "Prefeito", vice_prefeito: "Vice-prefeito", vereador: "Vereador",
  ministro: "Ministro", presidente_partido: "Presidente de Partido",
  pre_candidato: "Pré-candidato 2026",
};

// Cargos que NÃO vêm do TSE — só Firecrawl
const NON_TSE_CARGOS = new Set(["ministro", "presidente_partido", "pre_candidato"]);
const MUNICIPAL_CARGOS = new Set(["prefeito", "vice_prefeito", "vereador"]);
const FEDERAL_BR_CARGOS = new Set(["presidente", "vice_presidente"]);
const TSE_OPEN_DATA_BASE = "https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand";

// IDs reais do endpoint /eleicao/ordinarias do TSE
const ELEICAO_MUN_2024 = 2045202024;
const ELEICAO_FED_2022 = 2040602022;

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

const REGION_BY_UF: Record<string, string> = {
  AC:"norte", AM:"norte", AP:"norte", PA:"norte", RO:"norte", RR:"norte", TO:"norte",
  AL:"nordeste", BA:"nordeste", CE:"nordeste", MA:"nordeste", PB:"nordeste", PE:"nordeste", PI:"nordeste", RN:"nordeste", SE:"nordeste",
  DF:"centro-oeste", GO:"centro-oeste", MT:"centro-oeste", MS:"centro-oeste",
  ES:"sudeste", MG:"sudeste", RJ:"sudeste", SP:"sudeste",
  PR:"sul", RS:"sul", SC:"sul",
};

const TSE_LABEL_TO_CARGO: Record<string, string> = {
  "presidente": "presidente",
  "vice-presidente": "vice_presidente",
  "governador": "governador",
  "vice-governador": "vice_governador",
  "senador": "senador",
  "deputado federal": "deputado_federal",
  "deputado estadual": "deputado_estadual",
  "deputado distrital": "deputado_distrital",
  "prefeito": "prefeito",
  "vice-prefeito": "vice_prefeito",
  "vereador": "vereador",
};

const openDataZipCache = new Map<number, Uint8Array>();

const DECEASED_BLACKLIST = new Set([
  "getulio vargas","eneas carneiro","ulysses guimaraes","tancredo neves","leonel brizola",
  "mario covas","itamar franco","jose alencar","eduardo campos","luiz carlos prestes",
  "miguel arraes","brizola","jango","goulart","fernando collor pai",
]);

// ============ HELPERS ============
function normalize(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out.map((s) => s.replace(/^"|"$/g, "").trim());
}

function cargoFromTseLabel(raw: unknown): string | null {
  return TSE_LABEL_TO_CARGO[normalize(raw).replace(/\s+/g, " ")] ?? null;
}

function isEleitoTse(raw: unknown): boolean {
  const s = normalize(raw);
  return s === "eleito" || s === "eleito por qp" || s === "eleito por media" || s.startsWith("eleito");
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
  if (CARGO_TO_TSE[n] || NON_TSE_CARGOS.has(n)) return n;
  const aliases: Record<string, string> = {
    "vice": "vice_presidente",
    "presidente_da_republica": "presidente",
    "deputado": "deputado_federal",
    "ministro_de_estado": "ministro",
    "presidente_de_partido": "presidente_partido",
    "pre_candidato_2026": "pre_candidato",
  };
  return aliases[n] ?? null;
}

function nameKey(name: string): string {
  const tokens = normalize(name).split(/\s+/).filter((t) => t.length > 1 && !["da","de","do","das","dos","e"].includes(t));
  if (tokens.length === 0) return normalize(name);
  return `${tokens[0]}|${tokens[tokens.length - 1]}`;
}

// ============ FILTROS ============
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
  console.log("REQUEST BODY:", JSON.stringify(body));
  console.log("QUERY RECEIVED:", body.q ?? url.searchParams.get("q"));
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

// ============ SCHEMA SAÍDA ============
interface OutRow {
  id: string; tse_id: string | null; nome: string; nome_urna: string | null;
  partido_sigla: string | null; partido_nome: string | null; numero_partido: string | null;
  cargo: string | null; regiao: null; estado: string | null; municipio: string | null;
  eleito: boolean; categoria: string; ano_eleicao: number | null;
  foto_url: string | null; redes_sociais: null; popularidade: number;
  similarity: number; total_count: number;
  fonte: string; confidence: number;
}

// Aliases políticos: chave normalizada -> nomes alternativos (também normalizados)
const POLITICAL_ALIASES: Record<string, string[]> = {
  "lula": ["luiz inacio lula da silva", "presidente lula", "luiz lula", "lula da silva"],
  "bolsonaro": ["jair messias bolsonaro", "jair bolsonaro"],
  "jair bolsonaro": ["jair messias bolsonaro", "bolsonaro"],
  "tarcisio": ["tarcisio gomes de freitas", "tarcisio de freitas"],
  "alckmin": ["geraldo alckmin"],
  "ratinho": ["ratinho junior", "carlos massa junior", "ratinho jr"],
  "zema": ["romeu zema"],
  "temer": ["michel temer"],
  "haddad": ["fernando haddad"],
  "marina": ["marina silva"],
  "tebet": ["simone tebet"],
  "moro": ["sergio moro"],
  "boulos": ["guilherme boulos"],
  "nikolas": ["nikolas ferreira"],
  "janones": ["andre janones"],
  "caiado": ["ronaldo caiado"],
  "mourao": ["hamilton mourao"],
  "kassab": ["gilberto kassab"],
  "lira": ["arthur lira"],
  "martinelli": ["gustavo martinelli"],
  "paes": ["eduardo paes"],
  "nunes": ["ricardo nunes"],
};

function expandAliases(q: string): string[] {
  const n = normalize(q);
  if (!n) return [];
  const set = new Set<string>([n]);
  if (POLITICAL_ALIASES[n]) POLITICAL_ALIASES[n].forEach((a) => set.add(normalize(a)));
  // reverse lookup: query é um nome completo cuja chave curta existe
  for (const [key, vals] of Object.entries(POLITICAL_ALIASES)) {
    if (vals.some((v) => normalize(v) === n)) {
      set.add(key);
      vals.forEach((v) => set.add(normalize(v)));
    }
  }
  return Array.from(set);
}

async function searchLocalCatalog(f: Filters): Promise<OutRow[]> {
  if (!f.q?.trim()) return [];
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) { console.log("[local-catalog] env ausente"); return []; }
  const terms = expandAliases(f.q);
  console.log("[local-catalog] termos expandidos:", terms);
  try {
    const admin = createClient(url, key, { auth: { persistSession: false } });
    const collected: any[] = [];
    const seen = new Set<string>();
    for (const term of terms) {
      const { data, error } = await admin.rpc("search_politicians", {
        q: term,
        p_cargo: f.cargos.length ? f.cargos : null,
        p_partido: f.partidos.length ? f.partidos : null,
        p_regiao: null,
        p_estado: f.ufs.length ? f.ufs : null,
        p_municipio: f.municipio?.trim() || null,
        p_only_eleitos: !!f.onlyEleitos,
        p_limit: 200,
        p_offset: 0,
      });
      if (error) { console.log("[local-catalog] erro:", error.message); continue; }
      const rows = Array.isArray(data) ? data : [];
      for (const r of rows) {
        const key = String(r.id);
        if (seen.has(key)) continue;
        seen.add(key);
        collected.push(r);
      }
    }
    console.log(`[local-catalog] ${collected.length} resultados (após aliases)`);
    return collected.map((r: any) => ({
      id: `local-${r.id}`,
      tse_id: r.tse_id ?? null,
      nome: r.nome,
      nome_urna: r.nome_urna ?? null,
      partido_sigla: r.partido_sigla ?? null,
      partido_nome: r.partido_nome ?? null,
      numero_partido: r.numero_partido ?? null,
      cargo: r.cargo ?? null,
      regiao: r.regiao ?? null,
      estado: r.estado ?? null,
      municipio: r.municipio ?? null,
      eleito: !!r.eleito,
      categoria: r.eleito ? "eleito" : "ex_candidato",
      ano_eleicao: r.ano_eleicao ?? null,
      foto_url: r.foto_url ?? null,
      redes_sociais: r.redes_sociais ?? null,
      popularidade: Number(r.popularidade ?? 0.5),
      similarity: Number(r.similarity ?? 1),
      total_count: Number(r.total_count ?? collected.length),
      fonte: "catalogo-local",
      confidence: 100,
    }));
  } catch (e) {
    console.log("[local-catalog] falha:", (e as Error).message);
    return [];
  }
}

// ============ CAMADA 1 — TSE ============
async function tseFetch<T>(path: string, deadline: number): Promise<T | null> {
  if (Date.now() > deadline) return null;
  const url = `${TSE_BASE}${path}`;
  console.log("TSE REQUEST:", url);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 ClimaPolitico/2.0",
        "Accept": "application/json",
        "Referer": "https://divulgacandcontas.tse.jus.br/",
      },
    });
    clearTimeout(t);
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.log(`TSE HTTP ${r.status} ${url} :: ${body.slice(0, 200)}`);
      return null;
    }
    const json = await r.json() as T;
    return json;
  } catch (e) {
    console.log(`TSE FETCH ERROR ${url}:`, (e as Error).message);
    return null;
  }
}

async function listMunicipios(_ano: number, cdEleicao: number, uf: string, deadline: number) {
  // Endpoint correto: /eleicao/buscar/{UF}/{cdEleicao}/municipios
  const data = await tseFetch<any>(`/eleicao/buscar/${uf}/${cdEleicao}/municipios`, deadline);
  const arr = data?.municipios ?? [];
  const out = Array.isArray(arr)
    ? arr.map((m: any) => ({
        codigo: Number(m.codigo ?? m.sigla ?? m.cdMunicipio),
        nome: String(m.nome ?? m.nm ?? ""),
      })).filter((m) => m.codigo > 0 && m.nome)
    : [];
  console.log(`TSE municipios ${uf}/${cdEleicao} → ${out.length}`);
  return out;
}

async function fetchCandidatos(ano: number, escopo: string | number, cdEleicao: number, cargoCodigo: number, deadline: number) {
  const data = await tseFetch<any>(`/candidatura/listar/${ano}/${escopo}/${cdEleicao}/${cargoCodigo}/candidatos`, deadline);
  const list = data?.candidatos ?? [];
  return Array.isArray(list) ? list : [];
}


function statusFromTse(desc: string | undefined): { label: string; eleito: boolean; categoria: string } {
  const n = normalize(desc ?? "");
  if (n.includes("eleito") && !n.includes("nao") && !n.includes("não")) return { label: "Eleito", eleito: true, categoria: "eleito" };
  if (n.includes("nao eleito") || n.includes("não eleito") || n === "ne" || n === "nelei") return { label: "Não eleito", eleito: false, categoria: "ex_candidato" };
  if (n.includes("suplente")) return { label: "Suplente", eleito: false, categoria: "ex_candidato" };
  if (n.includes("indef") || n.includes("renunc") || n.includes("cassad")) return { label: "Inválido", eleito: false, categoria: "ex_candidato" };
  return { label: "Candidato", eleito: false, categoria: "ex_candidato" };
}

function mapTse(c: any, cargoKey: string, uf: string | null, municipio: string | null, ano: number): OutRow | null {
  const nome = c.nomeCompleto ?? c.nm ?? c.nomeUrna ?? c.nmU;
  if (!nome) return null;
  if (DECEASED_BLACKLIST.has(normalize(nome))) return null;
  const nomeUrna = c.nomeUrna ?? c.nmU ?? null;
  const sq = c.sqCandidato ?? c.id ?? c.sq ?? null;
  const partidoSigla = c.partido?.sigla ?? c.sgPartido ?? null;
  const partidoNumero = c.partido?.numero ?? c.nrPartido ?? null;
  const partidoNome = c.partido?.nome ?? c.nmPartido ?? null;
  const desc = c.descricaoTotalizacao ?? c.descricaoSituacao ?? c.descricaoSituacaoCandidato ?? c.dsSit ?? c.st ?? "";
  const st = statusFromTse(desc);
  return {
    id: `tse-${ano}-${sq ?? `${normalize(nome)}-${uf ?? ""}-${municipio ?? ""}`}`,
    tse_id: sq ? String(sq) : null,
    nome: String(nome), nome_urna: nomeUrna ? String(nomeUrna) : null,
    partido_sigla: partidoSigla ? String(partidoSigla).toUpperCase() : null,
    partido_nome: partidoNome ? String(partidoNome) : null,
    numero_partido: partidoNumero != null ? String(partidoNumero) : null,
    cargo: cargoKey, regiao: null, estado: uf, municipio,
    eleito: st.eleito, categoria: st.categoria, ano_eleicao: ano,
    foto_url: c.fotoUrl ?? null, redes_sociais: null,
    popularidade: st.eleito ? 1 : 0.5, similarity: 1, total_count: 0,
    fonte: `tse-${ano}`, confidence: 100,
  };
}

async function fetchOpenDataZip(year: number, deadline: number): Promise<Uint8Array | null> {
  const cached = openDataZipCache.get(year);
  if (cached) return cached;
  if (Date.now() > deadline) return null;
  const url = `${TSE_OPEN_DATA_BASE}/consulta_cand_${year}.zip`;
  console.log("TSE OPEN DATA REQUEST:", url);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "Accept": "application/zip,application/octet-stream,*/*",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Referer": "https://www.tse.jus.br/",
      },
    });
    clearTimeout(t);
    if (!res.ok) { console.log(`[tse-open-data] HTTP ${res.status}`); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    openDataZipCache.set(year, bytes);
    return bytes;
  } catch (e) {
    console.log("[tse-open-data] erro download:", (e as Error).message);
    return null;
  }
}

function mapOpenDataRow(row: Record<string, string>, year: number): OutRow | null {
  const nome = row.NM_CANDIDATO || row.NM_URNA_CANDIDATO;
  const cargo = cargoFromTseLabel(row.DS_CARGO);
  if (!nome || !cargo) return null;
  const uf = row.SG_UF === "BR" ? null : (row.SG_UF || null);
  const municipio = MUNICIPAL_CARGOS.has(cargo) ? (row.NM_UE || null) : null;
  const eleito = isEleitoTse(row.DS_SIT_TOT_TURNO);
  const tseId = row.SQ_CANDIDATO || `${year}-${normalize(nome)}-${uf ?? "BR"}-${municipio ?? ""}`;
  return {
    id: `tse-open-${year}-${tseId}`,
    tse_id: tseId,
    nome,
    nome_urna: row.NM_URNA_CANDIDATO || null,
    partido_sigla: row.SG_PARTIDO || null,
    partido_nome: row.NM_PARTIDO || null,
    numero_partido: row.NR_PARTIDO || null,
    cargo,
    regiao: null,
    estado: uf,
    municipio,
    eleito,
    categoria: eleito ? "eleito" : "ex_candidato",
    ano_eleicao: year,
    foto_url: null,
    redes_sociais: null,
    popularidade: eleito ? 1 : 0.5,
    similarity: 1,
    total_count: 0,
    fonte: `tse-open-data-${year}`,
    confidence: 100,
  };
}

function nameMatchesQuery(row: Record<string, string>, q: string): boolean {
  const hay = normalize(`${row.NM_CANDIDATO ?? ""} ${row.NM_URNA_CANDIDATO ?? ""} ${row.NM_SOCIAL_CANDIDATO ?? ""}`);
  const candidates = expandAliases(q);
  for (const cand of candidates) {
    if (!cand) continue;
    if (hay.includes(cand)) return true;
    const tokens = cand.split(/\s+/).filter(Boolean);
    if (tokens.length && tokens.every((t) => hay.split(/\s+/).some((h) => h.includes(t) || t.includes(h)))) return true;
  }
  return false;
}

async function searchOpenDataYear(year: number, cargoKey: string | null, f: Filters, deadline: number): Promise<OutRow[]> {
  if (!f.q || Date.now() > deadline) return [];
  const zip = await fetchOpenDataZip(year, deadline);
  if (!zip) return [];

  const targetUfs = new Set(f.ufs);
  const q = normalize(f.q);
  const files = unzipSync(zip, {
    filter: (file) => {
      if (!new RegExp(`consulta_cand_${year}_(BRASIL|[A-Z]{2})\\.csv$`, "i").test(file.name)) return false;
      if (targetUfs.size === 0) return true;
      return [...targetUfs].some((uf) => file.name.toUpperCase().endsWith(`_${uf}.CSV`));
    },
  });

  const best = new Map<string, OutRow>();
  for (const [fileName, bytes] of Object.entries(files)) {
    if (Date.now() > deadline) break;
    const text = new TextDecoder("iso-8859-1").decode(bytes);
    const lines = text.split(/\r?\n/);
    if (lines.length < 2) continue;
    const header = parseCsvLine(lines[0]).map((h) => h.toUpperCase());
    const idx = (name: string) => header.indexOf(name);
    const needed = ["SQ_CANDIDATO", "NM_CANDIDATO", "NM_URNA_CANDIDATO", "DS_CARGO", "SG_UF", "NM_UE", "DS_SIT_TOT_TURNO"];
    if (needed.some((n) => idx(n) < 0)) { console.log(`[tse-open-data] schema inesperado ${fileName}`); continue; }

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const cols = parseCsvLine(line);
      const row: Record<string, string> = {};
      for (let c = 0; c < header.length; c++) row[header[c]] = cols[c] ?? "";
      if (!nameMatchesQuery(row, q)) continue;
      const cargo = cargoFromTseLabel(row.DS_CARGO);
      if (!cargo || (cargoKey && cargo !== cargoKey)) continue;
      if (f.ufs.length && !f.ufs.includes(row.SG_UF)) continue;
      if (f.municipio && !normalize(row.NM_UE).includes(normalize(f.municipio))) continue;
      if (f.partidos.length && !f.partidos.includes((row.SG_PARTIDO ?? "").toUpperCase())) continue;
      if (f.onlyEleitos && !isEleitoTse(row.DS_SIT_TOT_TURNO)) continue;
      const mapped = mapOpenDataRow(row, year);
      if (!mapped) continue;
      const prev = best.get(mapped.tse_id ?? mapped.id);
      const prevScore = prev ? (prev.eleito ? 10 : 0) + Number(prev.ano_eleicao ?? 0) / 10_000 : -1;
      const score = (mapped.eleito ? 10 : 0) + Number(mapped.ano_eleicao ?? 0) / 10_000;
      if (!prev || score >= prevScore) best.set(mapped.tse_id ?? mapped.id, mapped);
    }
  }
  const rows = [...best.values()];
  console.log(`[tse-open-data] ${year} ${cargoKey ?? "livre"} → ${rows.length}`);
  return rows;
}

async function searchOpenData(cargoKey: string | null, f: Filters, deadline: number): Promise<OutRow[]> {
  const years = cargoKey && MUNICIPAL_CARGOS.has(cargoKey)
    ? [2024]
    : cargoKey && CARGO_TO_TSE[cargoKey]
    ? [2022, 2024]
    : [2024, 2022];
  const out: OutRow[] = [];
  for (const year of years) {
    if (Date.now() > deadline) break;
    const rows = await searchOpenDataYear(year, cargoKey, f, deadline);
    out.push(...rows);
    if (rows.length > 0 && !cargoKey) break;
  }
  return out;
}

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }));
  return results;
}

async function searchTSE(cargoKey: string, f: Filters, deadline: number): Promise<{ rows: OutRow[]; partial: boolean }> {
  const cargoCodigo = CARGO_TO_TSE[cargoKey];
  if (!cargoCodigo) return { rows: [], partial: false };
  const isMun = MUNICIPAL_CARGOS.has(cargoKey);
  const isBR = FEDERAL_BR_CARGOS.has(cargoKey);
  const ano = isMun ? 2024 : 2022;
  const cdEleicao = isMun ? ELEICAO_MUN_2024 : ELEICAO_FED_2022;
  const out: OutRow[] = [];
  let partial = false;

  if (isBR) {
    const list = await fetchCandidatos(ano, "BR", cdEleicao, cargoCodigo, deadline);
    console.log(`[tse] BR ${cargoKey} → ${list.length}`);
    for (const c of list) { const r = mapTse(c, cargoKey, null, null, ano); if (r) out.push(r); }
    return { rows: out, partial };
  }

  const ufsTarget = f.ufs.length > 0 ? f.ufs : (isMun ? [] : UFS);
  if (isMun && ufsTarget.length === 0) {
    throw new Error("Para cargos municipais (prefeito/vereador), informe ao menos um estado.");
  }
  if (isMun && !f.municipio) {
    throw new Error("Para cargos municipais (prefeito/vereador), informe também o município — buscar em um estado inteiro excede o limite de processamento.");
  }

  for (const uf of ufsTarget) {
    if (Date.now() > deadline) { partial = true; break; }
    if (isMun) {
      const municipios = await listMunicipios(ano, cdEleicao, uf, deadline);
      if (municipios.length === 0) {
        throw new Error(`TSE crawler failed: não foi possível listar municípios de ${uf} (eleição ${cdEleicao}).`);
      }
      let alvo = municipios;
      if (f.municipio) {
        const n = normalize(f.municipio);
        alvo = municipios.filter((m) => normalize(m.nome).includes(n));
        console.log(`[tse] match município "${f.municipio}" em ${uf} → ${alvo.map((m) => `${m.nome}(${m.codigo})`).join(", ") || "NENHUM"}`);
        if (alvo.length === 0) {
          throw new Error(`Município "${f.municipio}" não encontrado em ${uf} no TSE.`);
        }
      }
      console.log(`[tse] ${uf} ${cargoKey} → ${alvo.length} municípios alvo`);
      const lists = await mapWithLimit(alvo, TSE_CONCURRENCY, async (m) => {
        if (Date.now() > deadline) { partial = true; return []; }
        const list = await fetchCandidatos(ano, m.codigo, cdEleicao, cargoCodigo, deadline);
        return list.map((c) => mapTse(c, cargoKey, uf, m.nome, ano)).filter((r): r is OutRow => !!r);
      });
      for (const sub of lists) out.push(...sub);
    } else {
      const list = await fetchCandidatos(ano, uf, cdEleicao, cargoCodigo, deadline);
      console.log(`[tse] ${uf} ${cargoKey} → ${list.length}`);
      for (const c of list) { const r = mapTse(c, cargoKey, uf, null, ano); if (r) out.push(r); }
    }
  }
  console.log(`RESULT COUNT TSE/${cargoKey}: ${out.length}`);
  return { rows: out, partial };
}

// ============ CAMADA 2 — FIRECRAWL ============
function buildQuery(cargoKey: string | null, f: Filters): string {
  const isNameOnly = !!f.q && !cargoKey && f.cargos.length === 0 && f.ufs.length === 0 && !f.municipio?.trim();
  if (isNameOnly) return `${f.q} político candidato vereador prefeito deputado brasil`;


  const parts: string[] = [];
  if (f.q) parts.push(f.q); // sem aspas para busca mais ampla
  if (cargoKey) {
    const label = CARGO_LABEL[cargoKey] ?? cargoKey;
    parts.push(label.toLowerCase());
  }
  if (f.municipio) parts.push(f.municipio);
  if (f.ufs[0]) parts.push(f.ufs[0]);
  if (cargoKey === "presidente" && !f.q) return "presidenciáveis brasil 2026";
  if (cargoKey === "ministro" && !f.q) parts.push("governo lula 2026");
  if (cargoKey === "presidente_partido" && !f.q) parts.push("brasil 2026");
  if (cargoKey === "pre_candidato" && !f.q) parts.push("brasil 2026");
  if (f.q && !cargoKey) parts.push("político candidato brasil");
  return parts.filter(Boolean).join(" ").trim() || "candidatos brasil 2026";
}

// Inferir cargo a partir da query quando o extractor não devolve cargo.
const CARGO_INFER_MAP: Array<[RegExp, string]> = [
  [/\bvereador(es)?\b/i, "vereador"],
  [/\bvice[\s-]?prefeito\b/i, "vice_prefeito"],
  [/\bprefeito(s)?\b/i, "prefeito"],
  [/\bdeputado federal\b/i, "deputado_federal"],
  [/\bdeputado estadual\b/i, "deputado_estadual"],
  [/\bdeputado distrital\b/i, "deputado_distrital"],
  [/\bsenador(es)?\b/i, "senador"],
  [/\bvice[\s-]?governador\b/i, "vice_governador"],
  [/\bgovernador(es)?\b/i, "governador"],
  [/\bpresidente\b/i, "presidente"],
];
function inferCargoFromQuery(query: string): string | null {
  for (const [re, cargo] of CARGO_INFER_MAP) if (re.test(query)) return cargo;
  return null;
}


async function scrapeDuckDuckGo(query: string, deadline: number): Promise<Array<{ url: string; title: string; markdown: string }>> {
  if (Date.now() > deadline) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=br-pt`, {
      method: "POST", signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    clearTimeout(t);
    if (!r.ok) { console.log(`[ddg] HTTP ${r.status}`); return []; }
    const html = await r.text();
    const out: Array<{ url: string; title: string; markdown: string }> = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 10) {
      const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      let url = m[1];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      out.push({ url, title: stripTags(m[2]), markdown: stripTags(m[3]) });
    }
    return out;
  } catch (e) {
    console.log("[ddg] erro:", (e as Error).message);
    return [];
  }
}

async function scrapeGoogle(query: string, deadline: number): Promise<Array<{ url: string; title: string; markdown: string }>> {
  if (Date.now() > deadline) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const r = await fetch(`https://www.google.com/search?q=${encodeURIComponent(query)}&hl=pt-BR&gl=br`, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    clearTimeout(t);
    if (!r.ok) { console.log(`[google] HTTP ${r.status}`); return []; }
    const html = await r.text();
    const out: Array<{ url: string; title: string; markdown: string }> = [];
    const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    // h3 inside anchor + nearby snippet div
    const re = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>([\s\S]{0,800})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null && out.length < 10) {
      const url = decodeURIComponent(m[1]);
      const title = stripTags(m[2]);
      const snippetMatch = m[3].match(/<(?:span|div)[^>]*>([^<]{40,400})<\/(?:span|div)>/);
      out.push({ url, title, markdown: snippetMatch ? stripTags(snippetMatch[1]) : title });
    }
    return out;
  } catch (e) {
    console.log("[google] erro:", (e as Error).message);
    return [];
  }
}

async function webSearch(query: string, deadline: number): Promise<Array<{ url: string; title: string; markdown: string }>> {
  const ddg = await scrapeDuckDuckGo(query, deadline);
  console.log("DDG COUNT:", ddg.length);
  if (ddg.length > 0) return ddg;
  const google = await scrapeGoogle(query, deadline);
  console.log("GOOGLE COUNT:", google.length);
  return google;
}

const HONORIFICS = new Set(["dr","dra","prof","profa","sr","sra","pastor","pr","cb","sgt","ten","cel","cap","cmdt","cmte"]);
function stripHonorifics(q: string): string {
  return normalize(q).split(/\s+/).filter((t) => t && !HONORIFICS.has(t.replace(/\./g, ""))).join(" ").trim();
}

function buildMultiQueries(f: Filters, cargoKey: string | null): string[] {
  const name = (f.q ?? "").trim();
  if (!name) return [buildQuery(cargoKey, f)];
  const cargoLabel = cargoKey ? (CARGO_LABEL[cargoKey] ?? cargoKey).toLowerCase() : null;
  const mun = f.municipio?.trim();
  const uf = f.ufs[0] ?? null;
  const out = new Set<string>();
  // Fontes municipais primeiro (vereadores, prefeitos locais)
  out.add(`"${name}" site:leg.br`);
  out.add(`"${name}" site:gov.br`);
  out.add(`"${name}" vereador`);
  out.add(`"${name}" prefeito`);
  out.add(`"${name}" política`);
  if (mun) out.add(`"${name}" ${mun}`);
  if (uf) out.add(`"${name}" ${uf}`);
  if (cargoLabel) out.add(`"${name}" ${cargoLabel}${mun ? ` ${mun}` : ""}${uf ? ` ${uf}` : ""}`);
  // Fallback geral (sem aspas) — pega o que escapa
  out.add(buildQuery(cargoKey, f));
  return [...out].slice(0, 6);
}

async function multiWebSearch(f: Filters, cargoKey: string | null, deadline: number) {
  const queries = buildMultiQueries(f, cargoKey);
  console.log("MULTI QUERIES:", JSON.stringify(queries));
  const seen = new Set<string>();
  const all: Array<{ url: string; title: string; markdown: string }> = [];
  let municipalCount = 0;
  for (const q of queries) {
    if (Date.now() > deadline) break;
    const r = await webSearch(q, deadline);
    for (const it of r) {
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      if (/(leg\.br|sapl|gov\.br)/i.test(it.url)) municipalCount++;
      all.push(it);
    }
    if (all.length >= 12) break;
  }
  console.log("MUNICIPAL COUNT:", municipalCount);
  console.log("WEB COUNT:", all.length);
  return all;
}



// Extrai candidatos do markdown via Cerebras (parser estruturado, NÃO gerador)
async function cerebrasExtract(markdown: string, cargoKey: string | null, query: string): Promise<Array<{ nome: string; nomeUrna: string | null; partido: string | null; cargo: string; cidade: string | null; uf: string | null; status: string }>> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key && !Deno.env.get("LOVABLE_API_KEY")) return [];

  const cargoLabel = cargoKey ? (CARGO_LABEL[cargoKey] ?? cargoKey) : null;
  const cargoLine = cargoLabel
    ? `para o cargo "${cargoLabel}"`
    : `de QUALQUER cargo político (presidente, governador, senador, deputado, prefeito, vereador, ministro, etc.)`;
  const prompt = `Extraia APENAS políticos REAIS mencionados no texto abaixo ${cargoLine}.
NÃO invente nomes. NÃO complete listas. Se o texto não mencionar a pessoa explicitamente, ignore.
NÃO inclua pessoas falecidas. NÃO inclua personagens históricos.

Para cada pessoa encontrada, retorne JSON estritamente neste formato:
{"candidatos":[{"nome":"Nome Completo","nomeUrna":"Nome de urna/apelido ou null","partido":"SIGLA ou null","cargo":"prefeito|vice_prefeito|vereador|deputado_federal|deputado_estadual|senador|governador|presidente|ministro|pre_candidato","cidade":"Cidade ou null","uf":"Nome do estado por extenso ou null","status":"Eleito|Candidato|Ex-candidato|Mandatário|Possível presidenciável"}]}

Contexto da busca: "${query}"
Texto:
${markdown.slice(0, 6000)}`;
  try {
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    const useGateway = !!lovableKey;
    const url = useGateway
      ? "https://ai.gateway.lovable.dev/v1/chat/completions"
      : "https://api.cerebras.ai/v1/chat/completions";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (useGateway) {
      headers["Lovable-API-Key"] = lovableKey!;
      headers["X-Lovable-AIG-SDK"] = "vercel-ai-sdk";
    } else {
      headers["Authorization"] = `Bearer ${key}`;
    }
    const r = await fetch(url, {
      method: "POST", headers,
      body: JSON.stringify({
        model: useGateway ? "google/gemini-3-flash-preview" : "llama-3.3-70b",
        messages: [
          { role: "system", content: "Você é um parser. Extrai dados estruturados de texto. NUNCA inventa informação. Retorna apenas JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) { console.log(`[extract] HTTP ${r.status} (${useGateway ? "gateway" : "cerebras"})`); return []; }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const arr = parsed?.candidatos ?? [];
    return Array.isArray(arr) ? arr.map((c: any) => ({
      nome: String(c.nome ?? "").trim(),
      nomeUrna: c.nomeUrna ? String(c.nomeUrna).trim() : null,
      partido: c.partido ? String(c.partido).toUpperCase() : null,
      cargo: (c.cargo && typeof c.cargo === "string" ? normalizeCargoKey(c.cargo) : null) ?? cargoKey ?? "pre_candidato",
      cidade: c.cidade ? String(c.cidade).trim() : null,
      uf: c.uf ? String(c.uf).trim() : null,
      status: String(c.status ?? "Candidato"),
    })).filter((c) => c.nome.length > 2) : [];
  } catch (e) {
    console.log("[cerebras] erro:", (e as Error).message);
    return [];
  }
}

const STATUS_TO_CATEGORIA: Record<string, string> = {
  "eleito": "eleito",
  "mandatario": "eleito",
  "candidato": "pre_candidato",
  "ex-candidato": "ex_candidato",
  "possivel presidenciavel": "pre_candidato",
};

async function cerebrasDirectLookup(name: string, cargoKey: string | null): Promise<Array<{ nome: string; nomeUrna: string | null; partido: string | null; cargo: string; cidade: string | null; uf: string | null; status: string }>> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) { console.log("[ai-lookup] LOVABLE_API_KEY ausente"); return []; }
  const prompt = `Você conhece a política brasileira atual (2024-2026). O usuário procura por: "${name}"${cargoKey ? ` (cargo: ${CARGO_LABEL[cargoKey] ?? cargoKey})` : ""}.

Retorne APENAS políticos REAIS cujo nome corresponda (exato ou parcial) à busca. Inclua prefeitos, vereadores, deputados, senadores, governadores, ministros, etc.
NÃO invente. Se não conhecer ninguém com esse nome, retorne {"candidatos":[]}.

Formato JSON estrito:
{"candidatos":[{"nome":"Nome Completo","nomeUrna":"Nome de urna/apelido ou null","partido":"SIGLA ou null","cargo":"prefeito|vice_prefeito|vereador|deputado_federal|deputado_estadual|senador|governador|presidente|ministro|pre_candidato","cidade":"Cidade ou null","uf":"Nome do estado por extenso ou null","status":"Eleito|Candidato|Ex-candidato|Mandatário"}]}`;
  const models = ["google/gemini-3-flash-preview"];
  for (const model of models) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "vercel-ai-sdk",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "Você é uma base de conhecimento sobre políticos brasileiros. Retorna APENAS JSON válido. Nunca inventa pessoas." },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        console.log(`[ai-lookup] ${model} HTTP ${r.status}: ${txt.slice(0, 200)}`);
        if (r.status === 429 || r.status === 503) continue;
        return [];
      }
      const data = await r.json();
      const content = data?.choices?.[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(content);
      const arr = parsed?.candidatos ?? [];
      console.log(`[ai-lookup] ${model} OK — ${Array.isArray(arr) ? arr.length : 0} resultados`);
      return Array.isArray(arr) ? arr.map((c: any) => ({
        nome: String(c.nome ?? "").trim(),
        nomeUrna: c.nomeUrna ? String(c.nomeUrna).trim() : null,
        partido: c.partido ? String(c.partido).toUpperCase() : null,
        cargo: (c.cargo && typeof c.cargo === "string" ? normalizeCargoKey(c.cargo) : null) ?? cargoKey ?? "pre_candidato",
        cidade: c.cidade ? String(c.cidade).trim() : null,
        uf: c.uf ? String(c.uf).trim() : null,
        status: String(c.status ?? "Candidato"),
      })).filter((c) => c.nome.length > 2) : [];
    } catch (e) {
      console.log(`[ai-lookup] ${model} erro:`, (e as Error).message);
    }
  }
  return [];
}

async function searchFirecrawl(cargoKey: string | null, f: Filters, deadline: number): Promise<OutRow[]> {
  console.log("STEP WEB SEARCH START");
  const results = await multiWebSearch(f, cargoKey, deadline);
  console.log("STEP WEB COUNT:", results.length);
  console.log("STEP WEB RAW:", JSON.stringify(results.slice(0, 10).map((r) => ({ url: r.url, title: r.title }))));

  const queryForExtract = (f.q ?? "") + (cargoKey ? ` ${CARGO_LABEL[cargoKey] ?? cargoKey}` : "");
  let extracted: Awaited<ReturnType<typeof cerebrasExtract>> = [];
  let fonte = "firecrawl+web";

  if (results.length > 0 && Date.now() < deadline) {
    const combined = results.slice(0, 5).map((r) => `# ${r.title}\n${r.markdown}`).join("\n\n---\n\n");
    extracted = await cerebrasExtract(combined, cargoKey, queryForExtract);
    console.log(`[cerebras] extraiu ${extracted.length} nomes`);
  }

  if (extracted.length === 0 && f.q && Date.now() < deadline) {
    console.log(`[ai-lookup] firecrawl vazio — consultando IA direto por "${f.q}"`);
    extracted = await cerebrasDirectLookup(f.q, cargoKey);
    console.log(`[ai-lookup] retornou ${extracted.length} candidatos`);
    if (extracted.length > 0) fonte = "ai-lookup";
  }

  // Inferir cargo pela query quando vier sem cargo estruturado.
  const inferredCargo = cargoKey ?? inferCargoFromQuery(queryForExtract);

  return extracted.map((c, i) => {
    const uf = resolveUF(c.uf) ?? (f.ufs[0] ?? null);
    const statusNorm = normalize(c.status);
    const categoria = STATUS_TO_CATEGORIA[statusNorm] ?? "pre_candidato";
    const cargoFinal = c.cargo || inferredCargo || "pre_candidato";
    return {
      id: `web-${normalize(c.nome).replace(/\s+/g, "-")}-${i}`,
      tse_id: null, nome: c.nome, nome_urna: c.nomeUrna,
      partido_sigla: c.partido, partido_nome: null, numero_partido: null,
      cargo: cargoFinal, regiao: null,
      estado: uf, municipio: c.cidade ?? f.municipio ?? null,
      eleito: categoria === "eleito", categoria, ano_eleicao: 2026,
      foto_url: null, redes_sociais: null,
      popularidade: 0.5, similarity: 1, total_count: 0,
      fonte, confidence: fonte === "ai-lookup" ? 60 : 75,
    } as OutRow;
  });
}


// ============ DEDUPE + FILTROS ============
function dedupe(rows: OutRow[]): OutRow[] {
  const seen = new Map<string, OutRow>();
  const mergeFonte = (a: string, b: string) => {
    const parts = new Set([...(a || "").split("+"), ...(b || "").split("+")].map((s) => s.trim()).filter(Boolean));
    return [...parts].join("+");
  };
  for (const r of rows) {
    const key = r.tse_id
      ? `tse|${r.tse_id}`
      : `${nameKey(r.nome)}|${r.cargo}|${r.estado ?? ""}|${normalize(r.municipio ?? "")}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, r); continue; }
    const score = (x: OutRow) => (x.fonte.startsWith("tse") ? 100 : 0) + (x.eleito ? 10 : 0) + x.confidence / 10;
    const winner = score(r) > score(prev) ? { ...r } : { ...prev };
    winner.fonte = mergeFonte(prev.fonte, r.fonte);
    seen.set(key, winner);
  }
  return [...seen.values()];
}


function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const v0 = new Array(b.length + 1).fill(0).map((_, i) => i);
  const v1 = new Array(b.length + 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }
  return v1[b.length];
}

function fuzzyTokenMatch(hayTokens: string[], token: string): boolean {
  if (token.length < 3) return hayTokens.some((h) => h.startsWith(token));
  for (const h of hayTokens) {
    if (h.includes(token) || token.includes(h)) return true;
    const maxDist = Math.max(1, Math.floor(token.length * 0.25));
    if (Math.abs(h.length - token.length) <= maxDist && levenshtein(h, token) <= maxDist) return true;
  }
  return false;
}

function applyFilters(rows: OutRow[], f: Filters): OutRow[] {
  const qRaw = normalize(f.q);
  const q = stripHonorifics(qRaw);
  const aliasTerms = qRaw ? expandAliases(qRaw).map(stripHonorifics).filter(Boolean) : [];
  const allTerms = Array.from(new Set([q, ...aliasTerms].filter(Boolean)));
  const selectedCargo = f.cargos[0] ?? null;
  console.log("CANDIDATES BEFORE FILTER:", rows.length);
  console.log("MATCH TERMS:", JSON.stringify(allTerms));
  const candidates = rows.filter((r) => {
    if (f.onlyEleitos && !r.eleito) {
      console.log("DISCARDED", { candidate: r.nome, reason: "not-eleito", cargo: r.cargo, selectedCargo });
      return false;
    }
    if (f.partidos.length && !f.partidos.includes((r.partido_sigla ?? "").toUpperCase())) {
      console.log("DISCARDED", { candidate: r.nome, reason: "partido", partido: r.partido_sigla });
      return false;
    }
    if (q) {
      const hay = normalize(`${r.nome} ${r.nome_urna ?? ""}`);
      const hayTokens = hay.split(/\s+/).filter(Boolean);
      for (const term of allTerms) {
        if (!term) continue;
        if (hay.includes(term)) return true;
        const tokens = term.split(/\s+/).filter(Boolean);
        if (tokens.length && tokens.every((t) => fuzzyTokenMatch(hayTokens, t))) return true;
        // Match parcial: pelo menos 1 token significativo (>=4) bate — cobre "Dr Kachan" -> "...Kachan Junior"
        const strong = tokens.filter((t) => t.length >= 4);
        if (strong.length && strong.some((t) => fuzzyTokenMatch(hayTokens, t))) return true;
      }
      console.log("DISCARDED", { candidate: r.nome, reason: "name-mismatch", cargo: r.cargo, selectedCargo });
      return false;
    }
    return true;
  });
  console.log("CANDIDATES AFTER FILTER:", candidates.length);
  return candidates;
}


function filterLog(f: Filters) {
  return {
    cargo: f.cargos.length ? f.cargos : null,
    estado: f.ufs.length ? f.ufs : null,
    municipio: f.municipio?.trim() || null,
  };
}

function addSourceForRows(sources: Set<string>, rows: OutRow[], fallback: string) {
  if (rows.length === 0) return;
  if (rows.some((r) => r.fonte === "ai-lookup")) sources.add("ai-lookup");
  else if (rows.some((r) => r.fonte.startsWith("firecrawl"))) sources.add("firecrawl");
  else sources.add(fallback);
}

async function searchByName(f: Filters, deadline: number): Promise<{ rows: OutRow[]; sources: Set<string>; partial: boolean }> {
  console.log("SEARCH MODE:", "name-only");
  console.log("QUERY:", f.q);
  console.log("FILTERS:", filterLog(f));

  const all: OutRow[] = [];
  const sources = new Set<string>();
  let partial = false;

  // Roda TSE-open-data + Web + Catálogo local SEMPRE em paralelo.
  const [webRes, localRes, openRes] = await Promise.allSettled([
    searchFirecrawl(null, f, deadline),
    searchLocalCatalog(f),
    searchOpenData(null, f, deadline),
  ]);

  const webRows = webRes.status === "fulfilled" ? webRes.value : [];
  const localRows = localRes.status === "fulfilled" ? localRes.value : [];
  const openRows = openRes.status === "fulfilled" ? openRes.value : [];

  console.log("WEB RESULTS:", webRows.length);
  console.log("LOCAL RESULTS:", localRows.length);
  console.log("TSE RESULTS:", openRows.length);

  all.push(...webRows, ...localRows, ...openRows);
  addSourceForRows(sources, webRows, "firecrawl");
  addSourceForRows(sources, localRows, "catalogo-local");
  addSourceForRows(sources, openRows, "tse-open-data");

  if (Date.now() > deadline) partial = true;
  console.log("RESULTS:", all.length);
  return { rows: all, sources, partial };
}

async function searchByFilters(f: Filters, deadline: number): Promise<{ rows: OutRow[]; sources: Set<string>; partial: boolean }> {
  console.log("SEARCH MODE:", "filters");
  console.log("QUERY:", f.q);
  console.log("FILTERS:", filterLog(f));

  const all: OutRow[] = [];
  const sources = new Set<string>();
  let partial = false;

  // Catálogo local: sempre tenta (rápido, in-DB).
  const localPromise = searchLocalCatalog(f).catch((e) => {
    console.log("[local-catalog] erro:", (e as Error).message); return [] as OutRow[];
  });

  const cargosTodo = f.cargos.length > 0 ? f.cargos : [null as unknown as string];

  // Dispara TSE + Web SEMPRE em paralelo para cada cargo.
  const tasks: Promise<{ kind: "tse" | "web" | "open"; cargo: string | null; rows: OutRow[]; partial?: boolean }>[] = [];

  for (const cargo of cargosTodo) {
    if (cargo && CARGO_TO_TSE[cargo]) {
      tasks.push(
        searchTSE(cargo, f, deadline)
          .then(({ rows, partial: p }) => ({ kind: "tse" as const, cargo, rows, partial: p }))
          .catch((e) => { console.log(`[tse] skip ${cargo}: ${(e as Error).message}`); return { kind: "tse" as const, cargo, rows: [] }; })
      );
      if (f.q) {
        tasks.push(
          searchOpenData(cargo, f, deadline)
            .then((rows) => ({ kind: "open" as const, cargo, rows }))
            .catch(() => ({ kind: "open" as const, cargo, rows: [] }))
        );
      }
    } else if (f.q) {
      tasks.push(
        searchOpenData(cargo ?? null, f, deadline)
          .then((rows) => ({ kind: "open" as const, cargo, rows }))
          .catch(() => ({ kind: "open" as const, cargo, rows: [] }))
      );
    }
    // Web SEMPRE roda em paralelo (regra nova: nunca depender só do TSE).
    tasks.push(
      searchFirecrawl(cargo, f, deadline)
        .then((rows) => ({ kind: "web" as const, cargo, rows }))
        .catch((e) => { console.log(`[web] skip ${cargo ?? "livre"}: ${(e as Error).message}`); return { kind: "web" as const, cargo, rows: [] }; })
    );
  }

  const results = await Promise.all(tasks);
  const localRows = await localPromise;
  console.log(`LOCAL RESULTS: ${localRows.length}`);
  all.push(...localRows);
  addSourceForRows(sources, localRows, "catalogo-local");

  for (const r of results) {
    console.log(`${r.kind.toUpperCase()} RESULTS (${r.cargo ?? "livre"}): ${r.rows.length}${r.partial ? " [parcial]" : ""}`);
    all.push(...r.rows);
    if (r.partial) partial = true;
    if (r.rows.length === 0) continue;
    if (r.kind === "tse") sources.add(`tse-${r.cargo && MUNICIPAL_CARGOS.has(r.cargo) ? 2024 : 2022}`);
    else if (r.kind === "open") addSourceForRows(sources, r.rows, "tse-open-data");
    else addSourceForRows(sources, r.rows, "firecrawl");
  }

  if (Date.now() > deadline) partial = true;
  console.log("RESULTS:", all.length);
  return { rows: all, sources, partial };
}


// ============ HANDLER ============
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const f = await readFilters(req);
    console.log("SERVER RECEIVED", JSON.stringify(f));
    console.log("FILTERS:", JSON.stringify(f));
    if (f.cargos.length === 0 && !f.q) {
      throw new Error("Selecione ao menos um cargo ou informe um nome para busca.");
    }
    const isNameOnly = !!f.q && f.cargos.length === 0 && f.ufs.length === 0 && !f.municipio?.trim();
    const eletivos = f.cargos.filter((c) => !!CARGO_TO_TSE[c]);
    const naoEletivos = f.cargos.filter((c) => NON_TSE_CARGOS.has(c));
    const sourcePlan = eletivos.length > 0 && naoEletivos.length === 0 ? "TSE"
      : naoEletivos.length > 0 && eletivos.length === 0 ? "WEB"
      : eletivos.length > 0 ? "TSE+WEB" : "WEB";
    console.log("SOURCE:", sourcePlan);

    const deadline = Date.now() + SOFT_TIMEOUT_MS;
    const { rows: all, sources, partial } = isNameOnly
      ? await searchByName(f, deadline)
      : await searchByFilters(f, deadline);

    const tseRows = all.filter((r) => r.fonte.startsWith("tse"));
    const webRows = all.filter((r) => r.fonte.includes("firecrawl") || r.fonte === "ai-lookup");
    console.log("STEP TSE COUNT:", tseRows.length);
    console.log("STEP TSE DATA:", JSON.stringify(tseRows.slice(0, 5).map((r) => ({ nome: r.nome, cargo: r.cargo, uf: r.estado, mun: r.municipio }))));
    console.log("STEP MERGED COUNT (pre-dedupe):", all.length);

    const deduped = dedupe(all);
    console.log("STEP MERGED COUNT (post-dedupe):", deduped.length);
    const filtered = applyFilters(deduped, f);

    console.log("FINAL COUNT:", filtered.length);
    console.log("FINAL TOP10:", JSON.stringify(filtered.slice(0, 10).map((r) => ({
      nome: r.nome, cargo: r.cargo, estado: r.estado, municipio: r.municipio, fonte: r.fonte,
    }))));
    console.log(`NORMALIZED: ${deduped.length} | RESULT COUNT: ${filtered.length}`);


    const total = filtered.length;
    const start = f.page * PAGE_SIZE;
    const paged = filtered.slice(start, start + PAGE_SIZE).map((r) => ({ ...r, total_count: total }));

    return new Response(JSON.stringify({
      rows: paged, total,
      hasMore: total > (f.page + 1) * PAGE_SIZE,
      exactTotal: true, suggestions: [], normalized: {},
      page: f.page, pageSize: PAGE_SIZE, fallback: false,
      partial, sources: [...sources],
      notice: paged.length === 0
        ? "Nenhum candidato encontrado. Refine os filtros ou tente buscar pelo nome."
        : partial
        ? `Resultado parcial — ${total} candidato(s). Refine pelo município/estado para coleta completa.`
        : `${total} candidato(s) encontrado(s). Fontes: ${[...sources].join(", ") || "—"}`,
      last_updated: new Date().toISOString(),
      source: [...sources].join("+") || "catalog",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[catalog-search] FAIL:", msg);
    return new Response(JSON.stringify({
      fallback: true, error: msg, message: msg, notice: msg,
      rows: [], total: 0, hasMore: false, exactTotal: true,
      suggestions: [], normalized: {}, page: 0, pageSize: PAGE_SIZE,
      partial: false, sources: [],
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
