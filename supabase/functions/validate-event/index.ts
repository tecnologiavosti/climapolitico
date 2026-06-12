// validate-event
// ============================================================================
// STEP 4 — Validação factual de eventos políticos.
//
// Classifica cada evento em confidence_level:
//   - 'confirmed' : >=1 fonte institucional OU >=3 grande imprensa
//   - 'probable'  : >=2 grande imprensa OU (1 grande imprensa + >=2 outras)
//   - 'weak'      : >=1 fonte qualquer mas sem corroboração
//   - 'noise'     : nenhuma fonte factual (ex: só social) -> is_social_only
//
// Calcula confidence_score (0..1) ponderado por credibility_score das fontes.
// Atualiza category_v2 por heurística de palavras-chave (operação/CPI/STF/...).
// Idempotente: pode rodar várias vezes; sempre recomputa do zero.
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

const DEFAULT_WINDOW_DAYS = 30;

const CATEGORY_RULES: { cat: string; kws: string[] }[] = [
  { cat: "operacao",     kws: ["operacao","operação","busca","apreensao","apreensão","pf ","policia federal","polícia federal"] },
  { cat: "judicial",     kws: ["stf","stj","tse","tcu","ministro","relator","julgamento","decisao","decisão","liminar","habeas"] },
  { cat: "investigacao", kws: ["investigacao","investigação","inquerito","inquérito","indiciamento","denuncia","denúncia","pgr","mpf"] },
  { cat: "cpi",          kws: ["cpi","comissao parlamentar","comissão parlamentar","depoimento","convocacao","convocação"] },
  { cat: "eleitoral",    kws: ["candidatura","registro","tse","propaganda eleitoral","urna","eleicao","eleição","campanha"] },
  { cat: "legislativo",  kws: ["votacao","votação","projeto","plenario","plenário","camara","câmara","senado","aprovado","aprovada","rejeitado","rejeitada"] },
  { cat: "crise",        kws: ["crise","escandalo","escândalo","polemica","polêmica","renuncia","renúncia","cassacao","cassação","impeachment"] },
  { cat: "discurso",     kws: ["discurso","entrevista","declaracao","declaração","disse","afirmou","criticou","defendeu"] },
];

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function classifyCategory(text: string): string {
  const t = normalize(text);
  for (const { cat, kws } of CATEGORY_RULES) {
    if (kws.some((k) => t.includes(k))) return cat;
  }
  return "outros";
}

interface RunStats {
  events_scanned: number;
  confirmed: number;
  probable: number;
  weak: number;
  noise: number;
  updated: number;
  errors: string[];
}

async function runValidation(
  admin: ReturnType<typeof createClient>,
  opts: { user_id?: string | null; candidate_ids?: string[] | null; window_days: number; only_unvalidated: boolean },
): Promise<RunStats> {
  const stats: RunStats = {
    events_scanned: 0, confirmed: 0, probable: 0, weak: 0, noise: 0, updated: 0, errors: [],
  };

  const since = new Date(Date.now() - opts.window_days * 86_400_000).toISOString();

  let q = admin
    .from("political_events")
    .select("id,user_id,candidate_id,event_name,title_canonical,description,peak_date,detection_source")
    .gte("peak_date", since);
  if (opts.only_unvalidated) q = q.is("confidence_level", null);
  if (opts.user_id) q = q.eq("user_id", opts.user_id);
  if (opts.candidate_ids?.length) q = q.in("candidate_id", opts.candidate_ids);

  const { data: events, error } = await q;
  if (error) { stats.errors.push(`load events: ${error.message}`); return stats; }
  const list = events || [];
  stats.events_scanned = list.length;
  if (list.length === 0) return stats;

  for (const ev of list as any[]) {
    const { data: srcs, error: sErr } = await admin
      .from("event_sources")
      .select("source_type,credibility_score,is_institutional,is_major_media")
      .eq("event_id", ev.id);
    if (sErr) { stats.errors.push(`sources ${ev.id}: ${sErr.message}`); continue; }
    const sources = (srcs || []) as any[];

    const inst = sources.filter((s) => s.is_institutional || s.source_type === "institutional").length;
    const major = sources.filter((s) => s.is_major_media || s.source_type === "major_news").length;
    const total = sources.length;
    const others = Math.max(0, total - inst - major);

    let level: "confirmed" | "probable" | "weak" | "noise";
    if (inst >= 1 || major >= 3) level = "confirmed";
    else if (major >= 2 || (major >= 1 && others >= 2)) level = "probable";
    else if (total >= 1) level = "weak";
    else level = "noise";

    // confidence_score = média ponderada de credibility (0..1)
    const credSum = sources.reduce((acc, s) => acc + (Number(s.credibility_score) || 0.5), 0);
    const base = total === 0 ? 0 : credSum / total;
    // Boost por institucional / penalidade por isolamento
    let score = base;
    if (inst >= 1) score = Math.min(1, score + 0.15);
    if (major >= 3) score = Math.min(1, score + 0.10);
    if (total === 0) score = 0;
    if (level === "weak") score = Math.min(score, 0.45);
    if (level === "noise") score = 0;

    const category = classifyCategory(
      `${ev.title_canonical || ev.event_name || ""} ${ev.description || ""}`,
    );

    const patch: Record<string, any> = {
      confidence_level: level,
      confidence_score: Number(score.toFixed(3)),
      category_v2: category,
      total_sources: total,
      institutional_sources: inst,
      major_media_sources: major,
      is_social_only: total === 0 && ev.detection_source !== "news",
      validated_at: new Date().toISOString(),
    };

    const { error: upErr } = await admin.from("political_events").update(patch).eq("id", ev.id);
    if (upErr) { stats.errors.push(`update ${ev.id}: ${upErr.message}`); continue; }
    stats.updated++;
    stats[level]++;
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
    const windowDays = Math.min(Math.max(Number(body?.window_days) || DEFAULT_WINDOW_DAYS, 1), 365);
    const candidateIds: string[] | null = Array.isArray(body?.candidate_ids) ? body.candidate_ids : null;
    const onlyUnvalidated = body?.only_unvalidated !== false; // default true
    const scopedUserId = isServiceRole ? (body?.user_id ?? null) : userId;

    const stats = await runValidation(admin, {
      user_id: scopedUserId,
      candidate_ids: candidateIds,
      window_days: windowDays,
      only_unvalidated: onlyUnvalidated,
    });

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("validate-event error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
