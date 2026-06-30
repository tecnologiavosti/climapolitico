// Busca híbrida: TSE oficial + pre_candidates (IA) + opcional web fallback.
// Mantém o payload de tse-search e adiciona candidate_type + confidence_score por linha.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeName } from "../_shared/normalize-name.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

async function aiWebFallback(payload: Body, authHeader: string | null): Promise<any[]> {
  const q = (payload.q || "").trim();
  const cargo = payload.cargo?.[0] || "";
  if (!q && !cargo) return [];

  const query = q
    ? `${q} política eleições Brasil pré-candidato 2026`
    : `pré-candidatos ${cargo} 2026 brasil${payload.estado?.[0] ? " " + payload.estado[0] : ""}`;

  console.log("[hybrid] AI SEARCH START:", query);

  // Web evidence via Firecrawl
  let snippets: string[] = [];
  let urls: string[] = [];
  if (FIRECRAWL_API_KEY) {
    try {
      const r = await fetch("https://api.firecrawl.dev/v2/search", {
        method: "POST",
        headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 6, lang: "pt", country: "br", tbs: "qdr:m" }),
      });
      const j = await r.json();
      const items = j?.data ?? j?.web ?? [];
      for (const it of items.slice(0, 6)) {
        if (it?.description) snippets.push(String(it.description));
        if (it?.title) snippets.push(String(it.title));
        if (it?.url) urls.push(String(it.url));
      }
    } catch (e) { console.warn("[hybrid] firecrawl err", e); }
  }

  if (!q) return []; // Topic-only search without a name → cannot classify a single person

  // Classify name via existing AI function
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/classify-political-figure`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader || `Bearer ${ANON_KEY}` },
      body: JSON.stringify({
        nome: q,
        estado: payload.estado?.[0] || undefined,
        municipio: payload.municipio || undefined,
        contexto: snippets.join("\n").slice(0, 1800),
        signals: urls.slice(0, 5).map((u) => ({ source: "web", url: u })),
      }),
    });
    if (!r.ok) { console.warn("[hybrid] classify failed", r.status); return []; }
    const cls = await r.json();
    if (!cls?.is_political || (cls.confidence ?? 0) < 40) return [];
    return [{
      id: `ai:${normalizeName(q)}`,
      tse_id: null,
      nome: q,
      nome_urna: null,
      partido_sigla: cls.partido_sugerido || null,
      partido_nome: null,
      numero_partido: null,
      cargo: (cls.cargo_sugerido || "").toLowerCase().replace(/\s+/g, "_") || null,
      regiao: null,
      estado: payload.estado?.[0] || null,
      municipio: payload.municipio || null,
      eleito: false,
      categoria: "pre_candidato" as const,
      ano_eleicao: null,
      foto_url: null,
      redes_sociais: {},
      popularidade: 0,
      similarity: 0.6,
      total_count: 0,
      candidate_type: cls.confidence >= 70 ? "pre_candidate" : "monitored",
      confidence_score: Number(cls.confidence || 0),
      reason: cls.reason || null,
    }];
  } catch (e) { console.warn("[hybrid] classify err", e); return []; }
}

interface Body {
  q?: string | null;
  cargo?: string[] | null;
  partido?: string[] | null;
  regiao?: string[] | null;
  estado?: string[] | null;
  municipio?: string | null;
  onlyEleitos?: boolean;
  page?: number;
  candidateType?: "official" | "pre_candidate" | "both";
}

const PAGE_SIZE = 50;

async function callTSE(payload: Body, authHeader: string | null) {
  const url = `${SUPABASE_URL}/functions/v1/tse-search`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader || `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    console.warn("[hybrid] tse-search failed", r.status);
    return { rows: [], total: 0, hasMore: false, sources: [] as string[] };
  }
  return await r.json();
}

async function fetchPreCandidates(payload: Body) {
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  let q = db.from("pre_candidates").select("*", { count: "exact" });

  if (payload.q) {
    const norm = normalizeName(payload.q);
    q = q.ilike("nome_normalizado", `%${norm}%`);
  }
  if (payload.estado?.length) q = q.in("estado", payload.estado);
  if (payload.municipio) q = q.ilike("municipio", `%${payload.municipio}%`);
  if (payload.cargo?.length) {
    // cargo_sugerido é texto livre; faz match parcial
    const ors = payload.cargo.map((c) => `cargo_sugerido.ilike.%${c}%`).join(",");
    q = q.or(ors);
  }

  q = q.order("confidence_score", { ascending: false }).limit(200);
  const { data, error, count } = await q;
  if (error) {
    console.warn("[hybrid] pre_candidates err", error.message);
    return { rows: [] as any[], total: 0 };
  }
  return { rows: data ?? [], total: count ?? 0 };
}

function mapPreCandidate(r: any) {
  return {
    id: `pre:${r.id}`,
    tse_id: null,
    nome: r.nome,
    nome_urna: null,
    partido_sigla: r.partido_sugerido,
    partido_nome: null,
    numero_partido: null,
    cargo: (r.cargo_sugerido || "").toLowerCase().replace(/\s+/g, "_") || null,
    regiao: null,
    estado: r.estado,
    municipio: r.municipio,
    eleito: false,
    categoria: "pre_candidato" as const,
    ano_eleicao: null,
    foto_url: null,
    redes_sociais: [
      ["instagram", r.instagram], ["facebook", r.facebook],
      ["tiktok", r.tiktok], ["youtube", r.youtube],
    ].reduce<Record<string, string>>((acc, [k, v]) => { if (v) acc[k as string] = v as string; return acc; }, {}),
    popularidade: Number(r.engagement_score || 0),
    similarity: 0.8,
    total_count: 0,
    candidate_type: "pre_candidate" as const,
    confidence_score: Number(r.confidence_score || 0),
    reason: r.reason || null,
  };
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

    const tasks: Promise<any>[] = [];
    tasks.push(candidateType === "pre_candidate"
      ? Promise.resolve({ rows: [], total: 0, hasMore: false, sources: [] })
      : callTSE(body, authHeader));
    tasks.push(candidateType === "official"
      ? Promise.resolve({ rows: [], total: 0 })
      : fetchPreCandidates(body));

    const [tse, pre] = await Promise.all(tasks);

    // Annotate TSE rows
    const tseRows = (tse.rows ?? []).map((r: any) => ({
      ...r,
      candidate_type: "official" as const,
      confidence_score: r.eleito ? 100 : 85,
    }));
    const preRows = pre.rows.map(mapPreCandidate);

    console.log("[hybrid] SEARCH TYPE:", candidateType);
    console.log("[hybrid] TSE COUNT:", tseRows.length);
    console.log("[hybrid] PRE COUNT:", preRows.length);

    // AI/Web fallback when nothing found and user wants AI/both
    let aiRows: any[] = [];
    const wantsAI = candidateType !== "official";
    if (wantsAI && tseRows.length === 0 && preRows.length === 0 && (body.q?.trim() || body.cargo?.length)) {
      aiRows = await aiWebFallback(body, authHeader);
      console.log("[hybrid] AI COUNT:", aiRows.length);
    }

    // Merge + dedupe (prefer official over pre_candidate over AI)
    const map = new Map<string, any>();
    for (const r of tseRows) map.set(dedupeKey(r), r);
    for (const r of preRows) {
      const k = dedupeKey(r);
      if (!map.has(k)) map.set(k, r);
    }
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
      ...(preRows.length ? ["pre_candidates"] : []),
    ];

    return new Response(JSON.stringify({
      rows: paged,
      total,
      hasMore: start + PAGE_SIZE < total,
      exactTotal: true,
      suggestions: tse.suggestions ?? [],
      normalized: tse.normalized ?? {},
      message: tse.message ?? tse.notice ?? null,
      fallback: !!tse.fallback,
      page,
      last_updated: tse.last_updated ?? new Date().toISOString(),
      nationalOnly: !!tse.nationalOnly,
      partial: !!tse.partial,
      sources,
      counts: {
        official: tseRows.length,
        pre_candidate: preRows.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[catalog-search-hybrid]", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
