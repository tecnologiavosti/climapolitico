// Catálogo Político 2026 — Crawler estruturado multi-fonte
// Camada 1: TSE oficial (divulgacandcontas) 2024 municipal + 2022 federal/estadual
// Camada 2: Firecrawl search (Wikipedia, G1, UOL, sites oficiais) p/ cargos não-TSE e nomes livres
// Camada 3: Cerebras (somente normalização/dedupe semântica/correção ortográfica). NUNCA gera candidatos.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

// ============ CONSTANTES ============
const PAGE_SIZE = 50;
const TSE_BASE = "https://divulgacandcontas.tse.jus.br/divulga/rest/v1";
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";
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

const DECEASED_BLACKLIST = new Set([
  "getulio vargas","eneas carneiro","ulysses guimaraes","tancredo neves","leonel brizola",
  "mario covas","itamar franco","jose alencar","eduardo campos","luiz carlos prestes",
  "miguel arraes","brizola","jango","goulart","fernando collor pai",
]);

// ============ HELPERS ============
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
  const desc = c.descricaoSituacao ?? c.descricaoSituacaoCandidato ?? c.dsSit ?? c.st ?? "";
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
  const parts: string[] = [];
  if (f.q) parts.push(`"${f.q}"`);
  if (cargoKey) {
    const label = CARGO_LABEL[cargoKey] ?? cargoKey;
    parts.push(cargoKey === "vereador" || cargoKey === "prefeito" ? `${label.toLowerCase()}es` : label.toLowerCase());
  }
  if (f.municipio) parts.push(f.municipio);
  if (f.ufs[0]) parts.push(f.ufs[0]);
  if (cargoKey === "presidente" && !f.q) return "presidenciáveis brasil 2026";
  if (cargoKey === "ministro" && !f.q) parts.push("governo lula 2026");
  if (cargoKey === "presidente_partido" && !f.q) parts.push("brasil 2026");
  if (cargoKey === "pre_candidato" && !f.q) parts.push("brasil 2026");
  // Quando é busca apenas por nome, adicionar contexto político BR
  if (f.q && !cargoKey) parts.push("político candidato brasil");
  return parts.filter(Boolean).join(" ").trim() || "candidatos brasil 2026";
}

async function firecrawlSearch(query: string, deadline: number): Promise<Array<{ url: string; title: string; markdown: string }>> {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) { console.log("[firecrawl] FIRECRAWL_API_KEY ausente"); return []; }
  if (Date.now() > deadline) return [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const r = await fetch(`${FIRECRAWL_BASE}/search`, {
      method: "POST", signal: ctrl.signal,
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query, limit: 8, lang: "pt", country: "br",
        scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      }),
    });
    clearTimeout(t);
    if (!r.ok) { console.log(`[firecrawl] HTTP ${r.status}`); return []; }
    const data = await r.json();
    const items = data?.data ?? data?.web ?? [];
    return Array.isArray(items) ? items.map((x: any) => ({
      url: x.url ?? "", title: x.title ?? "", markdown: x.markdown ?? x.description ?? "",
    })).filter((x) => x.markdown) : [];
  } catch (e) {
    console.log("[firecrawl] erro:", (e as Error).message);
    return [];
  }
}

// Extrai candidatos do markdown via Cerebras (parser estruturado, NÃO gerador)
async function cerebrasExtract(markdown: string, cargoKey: string | null, query: string): Promise<Array<{ nome: string; partido: string | null; cargo: string; cidade: string | null; uf: string | null; status: string }>> {
  const key = Deno.env.get("CEREBRAS_API_KEY");
  if (!key) return [];
  const cargoLabel = cargoKey ? (CARGO_LABEL[cargoKey] ?? cargoKey) : null;
  const cargoLine = cargoLabel
    ? `para o cargo "${cargoLabel}"`
    : `de QUALQUER cargo político (presidente, governador, senador, deputado, prefeito, vereador, ministro, etc.)`;
  const prompt = `Extraia APENAS políticos REAIS mencionados no texto abaixo ${cargoLine}.
NÃO invente nomes. NÃO complete listas. Se o texto não mencionar a pessoa explicitamente, ignore.
NÃO inclua pessoas falecidas. NÃO inclua personagens históricos.

Para cada pessoa encontrada, retorne JSON estritamente neste formato:
{"candidatos":[{"nome":"Nome Completo","partido":"SIGLA ou null","cargo":"prefeito|vice_prefeito|vereador|deputado_federal|deputado_estadual|senador|governador|presidente|ministro|pre_candidato","cidade":"Cidade ou null","uf":"Nome do estado por extenso ou null","status":"Eleito|Candidato|Ex-candidato|Mandatário|Possível presidenciável"}]}

Contexto da busca: "${query}"
Texto:
${markdown.slice(0, 6000)}`;
  try {
    const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.3-70b",
        messages: [
          { role: "system", content: "Você é um parser. Extrai dados estruturados de texto. NUNCA inventa informação. Retorna apenas JSON válido." },
          { role: "user", content: prompt },
        ],
        temperature: 0,
        response_format: { type: "json_object" },
        max_tokens: 2000,
      }),
    });
    if (!r.ok) { console.log(`[cerebras] HTTP ${r.status}`); return []; }
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    const arr = parsed?.candidatos ?? [];
    return Array.isArray(arr) ? arr.map((c: any) => ({
      nome: String(c.nome ?? "").trim(),
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

async function cerebrasDirectLookup(name: string, cargoKey: string | null): Promise<Array<{ nome: string; partido: string | null; cargo: string; cidade: string | null; uf: string | null; status: string }>> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) { console.log("[ai-lookup] LOVABLE_API_KEY ausente"); return []; }
  const prompt = `Você conhece a política brasileira atual (2024-2026). O usuário procura por: "${name}"${cargoKey ? ` (cargo: ${CARGO_LABEL[cargoKey] ?? cargoKey})` : ""}.

Retorne APENAS políticos REAIS cujo nome corresponda (exato ou parcial) à busca. Inclua prefeitos, vereadores, deputados, senadores, governadores, ministros, etc.
NÃO invente. Se não conhecer ninguém com esse nome, retorne {"candidatos":[]}.

Formato JSON estrito:
{"candidatos":[{"nome":"Nome Completo","partido":"SIGLA ou null","cargo":"prefeito|vice_prefeito|vereador|deputado_federal|deputado_estadual|senador|governador|presidente|ministro|pre_candidato","cidade":"Cidade ou null","uf":"Nome do estado por extenso ou null","status":"Eleito|Candidato|Ex-candidato|Mandatário"}]}`;
  const models = ["google/gemini-2.5-flash", "google/gemini-2.5-flash-lite", "google/gemini-2.5-pro"];
  for (const model of models) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
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
  const query = buildQuery(cargoKey, f);
  console.log("QUERY:", query);
  console.log("SOURCE: firecrawl");
  const results = await firecrawlSearch(query, deadline);
  console.log(`[firecrawl] ${results.length} páginas`);

  let extracted: Awaited<ReturnType<typeof cerebrasExtract>> = [];
  let fonte = "firecrawl+web";

  if (results.length > 0 && Date.now() < deadline) {
    const combined = results.slice(0, 5).map((r) => `# ${r.title}\n${r.markdown}`).join("\n\n---\n\n");
    extracted = await cerebrasExtract(combined, cargoKey, query);
    console.log(`[cerebras] extraiu ${extracted.length} nomes`);
  }

  // Fallback: se não veio nada do Firecrawl e temos nome → consulta direta na base de conhecimento Cerebras
  if (extracted.length === 0 && f.q && Date.now() < deadline) {
    console.log(`[ai-lookup] firecrawl vazio — consultando Cerebras direto por "${f.q}"`);
    extracted = await cerebrasDirectLookup(f.q, cargoKey);
    console.log(`[ai-lookup] retornou ${extracted.length} candidatos`);
    if (extracted.length > 0) fonte = "ai-lookup";
  }

  return extracted.map((c, i) => {
    const uf = resolveUF(c.uf) ?? (f.ufs[0] ?? null);
    const statusNorm = normalize(c.status);
    const categoria = STATUS_TO_CATEGORIA[statusNorm] ?? "pre_candidato";
    return {
      id: `web-${normalize(c.nome).replace(/\s+/g, "-")}-${i}`,
      tse_id: null, nome: c.nome, nome_urna: null,
      partido_sigla: c.partido, partido_nome: null, numero_partido: null,
      cargo: c.cargo ?? cargoKey ?? "pre_candidato", regiao: null,
      estado: uf, municipio: c.cidade,
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
  for (const r of rows) {
    const key = r.tse_id
      ? `tse|${r.tse_id}`
      : `${nameKey(r.nome)}|${r.cargo}|${r.estado ?? ""}|${normalize(r.municipio ?? "")}`;
    const prev = seen.get(key);
    if (!prev) { seen.set(key, r); continue; }
    // prefere TSE > Firecrawl, eleito > não eleito, maior confidence
    const score = (x: OutRow) => (x.fonte.startsWith("tse") ? 100 : 0) + (x.eleito ? 10 : 0) + x.confidence / 10;
    if (score(r) > score(prev)) seen.set(key, r);
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
  const q = normalize(f.q);
  return rows.filter((r) => {
    if (f.onlyEleitos && !r.eleito) return false;
    if (f.partidos.length && !f.partidos.includes((r.partido_sigla ?? "").toUpperCase())) return false;
    if (q) {
      const hay = normalize(`${r.nome} ${r.nome_urna ?? ""}`);
      const hayTokens = hay.split(/\s+/).filter(Boolean);
      const tokens = q.split(/\s+/).filter(Boolean);
      // 1) substring direta
      if (hay.includes(q)) return true;
      // 2) todos os tokens com fuzzy match
      if (tokens.every((t) => fuzzyTokenMatch(hayTokens, t))) return true;
      return false;
    }
    return true;
  });
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
    const eletivos = f.cargos.filter((c) => !!CARGO_TO_TSE[c]);
    const naoEletivos = f.cargos.filter((c) => NON_TSE_CARGOS.has(c));
    const sourcePlan = eletivos.length > 0 && naoEletivos.length === 0 ? "TSE"
      : naoEletivos.length > 0 && eletivos.length === 0 ? "WEB"
      : eletivos.length > 0 ? "TSE+WEB" : "WEB";
    console.log("SOURCE:", sourcePlan);

    const deadline = Date.now() + SOFT_TIMEOUT_MS;
    const all: OutRow[] = [];
    const sources = new Set<string>();
    let partial = false;

    // sem cargo + tem q → busca livre via Firecrawl
    const cargosTodo = f.cargos.length > 0 ? f.cargos : [null as unknown as string];

    for (const cargo of cargosTodo) {
      if (Date.now() > deadline) { partial = true; break; }
      console.log(`=== CARGO: ${cargo ?? "(livre)"} ===`);

      // Camada 1: TSE
      if (cargo && CARGO_TO_TSE[cargo]) {
        try {
          const { rows, partial: tsePartial } = await searchTSE(cargo, f, deadline);
          console.log(`RAW RESULTS (tse/${cargo}): ${rows.length}${tsePartial ? " [parcial]" : ""}`);
          all.push(...rows);
          if (rows.length > 0) sources.add(`tse-${MUNICIPAL_CARGOS.has(cargo) ? 2024 : 2022}`);
          if (tsePartial) partial = true;
        } catch (e) {
          console.log(`[tse] skip ${cargo}: ${(e as Error).message}`);
        }
      }

      // Camada 2: Firecrawl
      const tseEmpty = !cargo || !CARGO_TO_TSE[cargo] || all.length === 0;
      const needsWeb = !cargo || NON_TSE_CARGOS.has(cargo) || tseEmpty || !!f.q;
      if (needsWeb && Date.now() < deadline) {
        const webRows = await searchFirecrawl(cargo, f, deadline);
        console.log(`RAW RESULTS (web/${cargo ?? "livre"}): ${webRows.length}`);
        all.push(...webRows);
        if (webRows.length > 0) sources.add("firecrawl");
      }
    }

    const deduped = dedupe(all);
    const filtered = applyFilters(deduped, f);
    console.log(`NORMALIZED: ${deduped.length} | RESULT COUNT: ${filtered.length}`);
    console.log("CRAWLER RETURNED", filtered.length);
    console.log("BACKEND FINAL COUNT:", filtered.length);
    console.log("FIRST 5 BACKEND:", JSON.stringify(filtered.slice(0, 5).map((r) => ({
      nome: r.nome, cargo: r.cargo, estado: r.estado, municipio: r.municipio, eleito: r.eleito, fonte: r.fonte,
    }))));

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
