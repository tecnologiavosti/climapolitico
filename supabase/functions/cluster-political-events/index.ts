// cluster-political-events
// ============================================================================
// STEP 3 — Clustering semântico de eventos políticos.
//
// Objetivo: depois que detect-events-from-news cria 1 evento por
// (candidato, dia, headline), muitas vezes o MESMO fato gera N eventos
// quase-duplicados (cada veículo escreve um título diferente). Esta função
// agrupa esses eventos em UM evento canônico e migra todas as fontes.
//
// Estratégia (sem dependência externa, roda 100% em Postgres + JS):
//   1) Carrega eventos recentes do candidato (janela configurável de dias)
//      que ainda NÃO têm confidence_level definido (ou seja, STEP 4 ainda
//      não rodou) — assim o clustering é seguro e idempotente.
//   2) Para cada par dentro de uma janela temporal de +/- 2 dias, calcula
//      similaridade lexical:
//         - Jaccard de tokens significativos (>=4 chars, sem stopwords)
//         - bônus se compartilham entidades fortes (STF, TSE, PF, CPI,
//           operação, indiciamento, votação, julgamento, etc.)
//   3) Une com Union-Find quando similaridade >= THRESHOLD (0.45).
//   4) Em cada cluster, escolhe como CANÔNICO o evento com mais fontes
//      institucionais (desempate: mais fontes totais, depois mais antigo).
//   5) Migra event_sources dos demais para o canônico (UPSERT) e DELETA
//      os eventos duplicados. Recalcula contadores no canônico.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const DEFAULT_WINDOW_DAYS = 14;
const SIM_THRESHOLD = 0.45;
const TIME_WINDOW_DAYS = 2;

const STOPWORDS = new Set([
  "a","o","e","de","da","do","das","dos","em","no","na","nos","nas","para","por",
  "com","sem","um","uma","uns","umas","que","se","sua","seu","suas","seus","ao",
  "aos","os","as","ou","mais","menos","sobre","entre","ser","foi","sao","tem",
  "vai","vão","apos","após","ate","até","como","mas","pela","pelo","pelos","pelas",
  "esse","essa","isto","esta","este","essa","isso","aquele","aquela","ja","já",
]);

const STRONG_ENTITIES = [
  "stf","tse","tcu","cpi","pf","pgr","mpf","cnj","stj","trf",
  "operacao","operação","indiciamento","julgamento","votacao","votação",
  "denuncia","denúncia","prisao","prisão","busca","apreensao","apreensão",
  "impeachment","cassacao","cassação","investigacao","investigação",
  "escandalo","escândalo","delacao","delação","ministro","relator",
];

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of normalize(s).split(" ")) {
    if (t.length < 4) continue;
    if (STOPWORDS.has(t)) continue;
    out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function entityBonus(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const e of STRONG_ENTITIES) {
    if (a.has(e) && b.has(e)) shared++;
  }
  return Math.min(0.2, shared * 0.07);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

class UF {
  parent: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number {
    while (this.parent[x] !== x) { this.parent[x] = this.parent[this.parent[x]]; x = this.parent[x]; }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface EventRow {
  id: string;
  user_id: string;
  candidate_id: string;
  title_canonical: string | null;
  event_name: string;
  peak_date: string;
  total_sources: number | null;
  institutional_sources: number | null;
  major_media_sources: number | null;
  description: string | null;
}

interface RunStats {
  candidates_scanned: number;
  events_scanned: number;
  clusters_merged: number;
  events_deleted: number;
  sources_migrated: number;
  errors: string[];
}

async function runClustering(
  admin: ReturnType<typeof createClient>,
  opts: { user_id?: string | null; candidate_ids?: string[] | null; window_days: number },
): Promise<RunStats> {
  const stats: RunStats = {
    candidates_scanned: 0, events_scanned: 0,
    clusters_merged: 0, events_deleted: 0, sources_migrated: 0, errors: [],
  };

  const since = new Date(Date.now() - opts.window_days * 86_400_000).toISOString();

  // Carrega eventos elegíveis (sem confidence_level ainda definido)
  let q = admin
    .from("political_events")
    .select("id,user_id,candidate_id,title_canonical,event_name,peak_date,total_sources,institutional_sources,major_media_sources,description")
    .gte("peak_date", since)
    .is("confidence_level", null);
  if (opts.user_id) q = q.eq("user_id", opts.user_id);
  if (opts.candidate_ids?.length) q = q.in("candidate_id", opts.candidate_ids);

  const { data: events, error } = await q;
  if (error) { stats.errors.push(`load events: ${error.message}`); return stats; }
  const all = (events || []) as EventRow[];
  stats.events_scanned = all.length;
  if (all.length < 2) return stats;

  // Agrupa por candidato
  const byCandidate = new Map<string, EventRow[]>();
  for (const e of all) {
    if (!byCandidate.has(e.candidate_id)) byCandidate.set(e.candidate_id, []);
    byCandidate.get(e.candidate_id)!.push(e);
  }
  stats.candidates_scanned = byCandidate.size;

  for (const [, list] of byCandidate) {
    if (list.length < 2) continue;
    // Ordena por data
    list.sort((a, b) => a.peak_date.localeCompare(b.peak_date));
    const toks = list.map((e) => tokens(`${e.title_canonical || e.event_name} ${e.description || ""}`));
    const uf = new UF(list.length);

    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (daysBetween(list[i].peak_date, list[j].peak_date) > TIME_WINDOW_DAYS) break;
        const sim = jaccard(toks[i], toks[j]) + entityBonus(toks[i], toks[j]);
        if (sim >= SIM_THRESHOLD) uf.union(i, j);
      }
    }

    // Agrupa
    const clusters = new Map<number, number[]>();
    for (let i = 0; i < list.length; i++) {
      const r = uf.find(i);
      if (!clusters.has(r)) clusters.set(r, []);
      clusters.get(r)!.push(i);
    }

    for (const idxs of clusters.values()) {
      if (idxs.length < 2) continue;
      // Escolhe canônico
      idxs.sort((a, b) => {
        const A = list[a], B = list[b];
        const ai = A.institutional_sources || 0, bi = B.institutional_sources || 0;
        if (bi !== ai) return bi - ai;
        const at = A.total_sources || 0, bt = B.total_sources || 0;
        if (bt !== at) return bt - at;
        return A.peak_date.localeCompare(B.peak_date);
      });
      const canonical = list[idxs[0]];
      const dupes = idxs.slice(1).map((i) => list[i]);

      // Migra event_sources de cada duplicata para o canônico
      for (const d of dupes) {
        const { data: srcs, error: sErr } = await admin
          .from("event_sources")
          .select("source_name,source_type,url,title,snippet,published_at,credibility_score,is_institutional,is_major_media")
          .eq("event_id", d.id);
        if (sErr) { stats.errors.push(`load sources ${d.id}: ${sErr.message}`); continue; }
        if (srcs && srcs.length > 0) {
          const rows = srcs.map((s: any) => ({ ...s, event_id: canonical.id }));
          const { error: upErr, count } = await admin
            .from("event_sources")
            .upsert(rows, { onConflict: "event_id,url", count: "exact", ignoreDuplicates: true });
          if (upErr) stats.errors.push(`migrate sources -> ${canonical.id}: ${upErr.message}`);
          else stats.sources_migrated += count ?? rows.length;
        }
        // Apaga fontes antigas e o evento duplicado
        await admin.from("event_sources").delete().eq("event_id", d.id);
        const { error: delErr } = await admin.from("political_events").delete().eq("id", d.id);
        if (delErr) stats.errors.push(`delete dup ${d.id}: ${delErr.message}`);
        else stats.events_deleted++;
      }

      // Recalcula contadores do canônico
      const { data: counts } = await admin
        .from("event_sources")
        .select("source_type")
        .eq("event_id", canonical.id);
      const arr = (counts || []) as any[];
      await admin.from("political_events").update({
        total_sources: arr.length,
        institutional_sources: arr.filter((r) => r.source_type === "institutional").length,
        major_media_sources: arr.filter((r) => r.source_type === "major_news").length,
      }).eq("id", canonical.id);

      stats.clusters_merged++;
    }
  }

  return stats;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const auth = req.headers.get("Authorization") || "";
    const isServiceRole = auth.includes(SERVICE_KEY);

    let userId: string | null = null;
    if (!isServiceRole) {
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: auth } },
      });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = ud.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const windowDays = Math.min(Math.max(Number(body?.window_days) || DEFAULT_WINDOW_DAYS, 1), 120);
    const candidateIds: string[] | null = Array.isArray(body?.candidate_ids) ? body.candidate_ids : null;
    const scopedUserId = isServiceRole ? (body?.user_id ?? null) : userId;

    const stats = await runClustering(admin, {
      user_id: scopedUserId,
      candidate_ids: candidateIds,
      window_days: windowDays,
    });

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("cluster-political-events error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
