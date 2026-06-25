// Catálogo Político 100% dinâmico — busca em tempo real via web (DuckDuckGo) + Cerebras.
// Sem TSE local, sem cache, sem Supabase, sem base salva.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
const CEREBRAS_MODEL = "llama-3.3-70b";
const PAGE_SIZE = 50;

const VALID_CARGOS = [
  "presidente", "vice_presidente", "governador", "vice_governador",
  "senador", "deputado_federal", "deputado_estadual", "deputado_distrital",
  "prefeito", "vice_prefeito", "vereador", "ministro", "presidente_partido", "pre_candidato",
];

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
  ministro: "Ministro",
  presidente_partido: "Presidente de Partido",
  pre_candidato: "Pré-candidato 2026",
};

const CARGO_PLURAL: Record<string, string> = {
  presidente: "presidenciáveis",
  vice_presidente: "vice-presidentes",
  governador: "governadores",
  vice_governador: "vice-governadores",
  senador: "senadores",
  deputado_federal: "deputados federais",
  deputado_estadual: "deputados estaduais",
  deputado_distrital: "deputados distritais",
  prefeito: "prefeitos",
  vice_prefeito: "vice-prefeitos",
  vereador: "vereadores",
  ministro: "ministros",
  presidente_partido: "presidentes de partido",
  pre_candidato: "pré-candidatos 2026",
};

function normalize(s: string | null | undefined) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeCargoKey(raw: string): string | null {
  const n = normalize(raw).replace(/[^a-z ]/g, "").replace(/\s+/g, "_");
  if (VALID_CARGOS.includes(n)) return n;
  // tentativas comuns
  const map: Record<string, string> = {
    "vice": "vice_presidente",
    "presidente_da_republica": "presidente",
    "presidente_partido": "presidente_partido",
    "deputado": "deputado_federal",
    "pre_candidato_2026": "pre_candidato",
    "precandidato": "pre_candidato",
  };
  return map[n] ?? null;
}

interface Filters {
  q: string | null;
  cargo: string[] | null;
  partido: string[] | null;
  regiao: string[] | null;
  estado: string[] | null;
  municipio: string | null;
  onlyEleitos: boolean;
  page: number;
}

function csvParam(v: string | null) {
  if (!v) return null;
  return v.split(",").map((x) => x.trim()).filter(Boolean);
}

async function readFilters(req: Request): Promise<Filters> {
  const url = new URL(req.url);
  let body: any = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { /* noop */ }
  }
  const get = (k: string) => body[k] ?? url.searchParams.get(k);
  const getArr = (k: string) => {
    if (Array.isArray(body[k])) return body[k] as string[];
    return csvParam(url.searchParams.get(k));
  };
  return {
    q: (get("q") as string | null)?.trim() || null,
    cargo: getArr("cargo"),
    partido: getArr("partido"),
    regiao: getArr("regiao"),
    estado: getArr("estado"),
    municipio: (get("municipio") as string | null)?.trim() || null,
    onlyEleitos: String(get("somenteEleitos") ?? get("onlyEleitos") ?? "") === "true" || body.onlyEleitos === true,
    page: Math.max(0, Number(get("page") ?? 0)),
  };
}

function buildQuery(f: Filters): { query: string; cargos: string[] } {
  const cargos = (f.cargo ?? []).map((c) => normalizeCargoKey(c) ?? "").filter(Boolean);
  const cargoMain = cargos[0] ?? null;
  const cargoTerm = cargoMain
    ? (f.q ? (CARGO_LABEL[cargoMain] ?? cargoMain).toLowerCase() : (CARGO_PLURAL[cargoMain] ?? cargoMain))
    : (f.q ? "político" : "políticos");

  // caso especial: presidente sem nome → "presidenciáveis brasil 2026"
  if (!f.q && cargoMain === "presidente") {
    return { query: "presidenciáveis brasil 2026", cargos };
  }

  const parts: string[] = [];
  if (f.q) parts.push(cargoTerm, f.municipio ?? "", (f.estado ?? []).join(" ").toLowerCase(), f.q, (f.partido ?? []).join(" "));
  else parts.push(cargoTerm, f.municipio ?? "", (f.estado ?? []).join(" ").toLowerCase(), (f.partido ?? []).join(" "));

  if (f.onlyEleitos) parts.push("eleitos");
  if (!f.municipio && !f.estado?.length && !f.q) parts.push("brasil 2026");

  const query = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return { query: query || "políticos brasil 2026", cargos };
}

async function duckDuckGoSearch(query: string): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const endpoints = [
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml",
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        },
      });
      console.log(`[ddg] ${url} → HTTP ${r.status}`);
      if (!r.ok) continue;
      const html = await r.text();
      const results: Array<{ title: string; snippet: string; url: string }> = [];
      const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
      const cleanUrl = (raw: string) => {
        const uddg = raw.match(/[?&]uddg=([^&]+)/);
        if (uddg) { try { return decodeURIComponent(uddg[1]); } catch { /* noop */ } }
        return raw;
      };
      // html.duckduckgo.com layout
      const reHtml = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>)/g;
      let m: RegExpExecArray | null;
      while ((m = reHtml.exec(html)) !== null && results.length < 20) {
        results.push({ title: strip(m[2]), snippet: strip(m[3] ?? m[4] ?? ""), url: cleanUrl(m[1]) });
      }
      // lite.duckduckgo.com layout fallback
      if (results.length === 0) {
        const reLite = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;
        while ((m = reLite.exec(html)) !== null && results.length < 20) {
          results.push({ title: strip(m[2]), snippet: strip(m[3]), url: cleanUrl(m[1]) });
        }
      }
      console.log(`[ddg] "${query}" → ${results.length} results (html length=${html.length})`);
      if (results.length === 0) console.log("[ddg] html sample:", html.slice(0, 500));
      if (results.length > 0) return results;
    } catch (e) {
      console.error("[ddg] error:", e);
    }
  }
  return [];
}

function extractJsonFromResponse(response: string): unknown {
  let cleaned = response.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  const jsonStart = cleaned.search(/[\{\[]/);
  if (jsonStart === -1) throw new Error("No JSON found in response");
  const opener = cleaned[jsonStart];
  const closer = opener === "[" ? "]" : "}";
  const jsonEnd = cleaned.lastIndexOf(closer);
  if (jsonEnd === -1) throw new Error("No JSON terminator in response");
  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  try { return JSON.parse(cleaned); } catch {
    cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
    return JSON.parse(cleaned);
  }
}

interface CandidateOut {
  id: string;
  tse_id: null;
  nome: string;
  nome_urna: null;
  partido_sigla: string | null;
  partido_nome: null;
  numero_partido: null;
  cargo: string | null;
  regiao: null;
  estado: string | null;
  municipio: string | null;
  eleito: boolean;
  categoria: "eleito" | "ex_candidato" | "pre_candidato" | "lideranca_local";
  ano_eleicao: null;
  foto_url: null;
  redes_sociais: null;
  popularidade: number;
  similarity: number;
  total_count: number;
}

const STATUS_TO_CATEGORIA: Record<string, CandidateOut["categoria"]> = {
  "eleito": "eleito",
  "mandatario": "lideranca_local",
  "ministro": "lideranca_local",
  "presidente de partido": "lideranca_local",
  "lideranca": "lideranca_local",
  "pre-candidato": "pre_candidato",
  "precandidato": "pre_candidato",
  "ex-candidato": "ex_candidato",
};

async function aiExtract(query: string, snippets: Array<{ title: string; snippet: string; url: string }>, f: Filters, cargos: string[]): Promise<{ rows: CandidateOut[]; error: string | null }> {
  if (!CEREBRAS_API_KEY) return { rows: [], error: "CEREBRAS_API_KEY ausente" };
  if (snippets.length === 0) return { rows: [], error: null };

  const cargoNames = cargos.map((c) => CARGO_LABEL[c] ?? c).join(", ") || "qualquer";
  const system = `Você é um buscador político brasileiro.
Receberá snippets de busca web e filtros do usuário.
Tarefas:
1. Corrigir ortografia e acentos
2. Identificar candidatos REAIS mencionados nos snippets
3. Remover duplicatas
4. NUNCA inventar nomes — se não houver evidência clara nos snippets, retorne []
5. Respeitar os filtros (cargo, estado, município, partido, somente eleitos)

Status permitidos: Eleito, Pré-candidato, Mandatário, Ex-candidato, Ministro, Presidente de Partido.

Responda APENAS JSON:
{"resultados":[{"nome":"","cargo":"","partido":"","estado":"","cidade":"","status":""}]}

cargo DEVE ser um destes: ${VALID_CARGOS.join(", ")}.`;

  const user = `Filtros:
- nome: ${f.q ?? "(qualquer)"}
- cargo: ${cargoNames}
- partido: ${(f.partido ?? []).join(", ") || "(qualquer)"}
- estado: ${(f.estado ?? []).join(", ") || "(qualquer)"}
- município: ${f.municipio ?? "(qualquer)"}
- somente eleitos: ${f.onlyEleitos ? "sim" : "não"}

Query usada: ${query}

Snippets web (DuckDuckGo):
${snippets.slice(0, 15).map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`).join("\n\n")}

Retorne até 30 candidatos. JSON válido.`;

  try {
    const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${CEREBRAS_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 3000,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.error("[cerebras] failed:", r.status, txt.slice(0, 200));
      return { rows: [], error: `Cerebras ${r.status}` };
    }
    const j = await r.json();
    const parsed = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
    const list: any[] = parsed?.resultados ?? parsed?.results ?? [];
    const seen = new Set<string>();
    const rows: CandidateOut[] = [];
    list.forEach((p, idx) => {
      if (!p?.nome) return;
      const cargoKey = normalizeCargoKey(p.cargo ?? "") ?? (cargos[0] ?? null);
      const uf = (p.estado ?? "").toString().toUpperCase().slice(0, 2) || null;
      const status = normalize(p.status ?? "");
      const categoria = STATUS_TO_CATEGORIA[status] ?? "lideranca_local";
      const dedupKey = `${normalize(p.nome)}|${cargoKey ?? ""}|${uf ?? ""}|${normalize(p.cidade ?? "")}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      rows.push({
        id: `web-${idx}-${normalize(p.nome).replace(/\s+/g, "-")}`,
        tse_id: null,
        nome: String(p.nome),
        nome_urna: null,
        partido_sigla: p.partido ? String(p.partido).toUpperCase().slice(0, 16) : null,
        partido_nome: null,
        numero_partido: null,
        cargo: cargoKey,
        regiao: null,
        estado: uf,
        municipio: p.cidade ? String(p.cidade) : (f.municipio ?? null),
        eleito: categoria === "eleito",
        categoria,
        ano_eleicao: null,
        foto_url: null,
        redes_sociais: null,
        popularidade: 0.7,
        similarity: 1,
        total_count: 0,
      });
    });
    return { rows, error: null };
  } catch (e) {
    console.error("[cerebras] error:", e);
    return { rows: [], error: e instanceof Error ? e.message : String(e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const f = await readFilters(req);
    const { query, cargos } = buildQuery(f);
    console.log("[dynamic-search]", { filters: f, query, cargos });

    const snippets = await duckDuckGoSearch(query);
    const extra = (f.q || f.municipio) && snippets.length < 10
      ? await duckDuckGoSearch(`${query} site:wikipedia.org OR site:gov.br OR site:tse.jus.br`)
      : [];
    const allSnippets = [...snippets, ...extra];

    const { rows, error } = await aiExtract(query, allSnippets, f, cargos);

    // filtros determinísticos extras (cargo / município / UF)
    const cargoSet = new Set(cargos);
    const ufSet = new Set((f.estado ?? []).map((u) => u.toUpperCase()));
    const munNorm = normalize(f.municipio);
    const filtered = rows.filter((r) => {
      if (cargoSet.size > 0 && r.cargo && !cargoSet.has(r.cargo)) return false;
      if (ufSet.size > 0 && r.estado && !ufSet.has(r.estado)) return false;
      if (munNorm && r.municipio && !normalize(r.municipio).includes(munNorm)) return false;
      if (f.onlyEleitos && r.categoria !== "eleito") return false;
      return true;
    });

    const total = filtered.length;
    const paged = filtered.slice(f.page * PAGE_SIZE, (f.page + 1) * PAGE_SIZE).map((r) => ({ ...r, total_count: total }));

    console.log("[dynamic-search] result", { query, snippets: allSnippets.length, extracted: rows.length, filtered: total });

    return new Response(JSON.stringify({
      rows: paged,
      total,
      hasMore: total > (f.page + 1) * PAGE_SIZE,
      exactTotal: true,
      suggestions: [],
      normalized: {},
      page: f.page,
      pageSize: PAGE_SIZE,
      fallback: !!error && paged.length === 0,
      sourceUsed: { web: allSnippets.length, ai: rows.length, query },
      notice: paged.length === 0
        ? (error ? `Não foi possível consultar a internet agora: ${error}` : "Nenhum candidato encontrado com esses filtros")
        : "Resultado obtido em tempo real da internet — confirme antes de usar.",
      query,
      last_updated: new Date().toISOString(),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[dynamic-search] error:", e);
    return new Response(JSON.stringify({
      fallback: true,
      error: "SERVICE_FAILED",
      message: "Não foi possível consultar a internet agora.",
      rows: [], total: 0, suggestions: [], normalized: {}, page: 0,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
