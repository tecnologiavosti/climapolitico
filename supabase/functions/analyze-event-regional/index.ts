// External-first repercussion analyzer for a single political event.
// 1. Recollects external publications about the event (Firecrawl + GDELT).
// 2. Derives `externalRepercussion` (publications, reach, regional dist, narratives, themes).
// 3. Computes optional `internalReaction` from social_interactions (complement only).
// 4. Caches result on political_events.metadata.external_cache (TTL 6h).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { firecrawlSearch, gdeltSearch, dedupePublications, computeRegionalDistribution, estimatedReachOf, type ExternalPublication } from "../_shared/external-collector.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const REGIONS = ["Sudeste", "Nordeste", "Sul", "Centro-Oeste", "Norte"] as const;

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

function sanitize(s: unknown): string { return String(s ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr(401, "Unauthorized");
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonErr(401, "Unauthorized");

    const { eventId, rangeDays = 7, forceRefresh = false } = await req.json();
    if (!eventId) return jsonErr(400, "eventId obrigatório");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: event } = await admin.from("political_events").select("*").eq("id", eventId).eq("user_id", user.id).maybeSingle();
    if (!event) return jsonErr(404, "Evento não encontrado");
    const { data: candidate } = await admin.from("candidates").select("id, full_name, party").eq("id", event.candidate_id).maybeSingle();

    // 0) Cache check
    const cached = event.metadata?.external_cache;
    if (!forceRefresh && cached?.savedAt && (Date.now() - new Date(cached.savedAt).getTime() < CACHE_TTL_MS)) {
      return new Response(JSON.stringify({ ...cached.payload, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Recollect external publications for this event
    const baseKeywords: string[] = Array.isArray(event.keywords) ? event.keywords.filter(Boolean).slice(0, 6) : [];
    const cName = candidate?.full_name || "";
    const queryBase = baseKeywords.length
      ? `"${cName}" ${baseKeywords.slice(0, 3).map((k) => `"${k}"`).join(" OR ")}`
      : `"${cName}" "${event.event_name}"`;

    const tbs = rangeDays <= 7 ? "qdr:w" : "qdr:m";
    const results = await Promise.all([
      firecrawlSearch(queryBase, { limit: 15, tbs }),
      firecrawlSearch(`"${event.event_name}"`, { limit: 10, tbs }),
      gdeltSearch(cName, { maxRecords: 30, timespan: rangeDays <= 7 ? "1week" : "1month" }),
    ]);
    const pubs = dedupePublications(results.flat());

    // 2) Time-window the publications around the event date
    const eventTs = new Date(event.event_date).getTime();
    const winStart = eventTs - rangeDays * 86400000;
    const winEnd = eventTs + rangeDays * 86400000;
    const inWindow = pubs.filter((p) => {
      if (!p.publishedAt) return true;
      const t = new Date(p.publishedAt).getTime();
      return !isNaN(t) && t >= winStart && t <= winEnd;
    });
    const corpusPubs = inWindow.length >= 3 ? inWindow : pubs.slice(0, 25);

    // 3) Compute regional distribution + reach from real publications
    const regionalDistribution = computeRegionalDistribution(corpusPubs);
    const estimatedReach = estimatedReachOf(corpusPubs);

    // 4) AI: themes, sentiment signals, narratives, summary
    const aiCorpus = corpusPubs.slice(0, 40).map((p, i) =>
      `[${i + 1}] (${p.outlet}, ${p.publishedAt?.slice(0, 10) || "?"}, região ${p.outletRegion}) ${sanitize(p.title).slice(0, 150)} — ${sanitize(p.snippet).slice(0, 200)}`
    ).join("\n");

    const prompt = `Você é um analista político brasileiro. Analise a repercussão NACIONAL deste evento com base nas publicações reais abaixo.

Evento: "${event.event_name}" (${event.event_type}) em ${String(event.event_date).slice(0, 10)}.
Descrição: ${event.description || "(sem descrição)"}.
Candidato: ${cName}${candidate?.party ? ` (${candidate.party})` : ""}.

PUBLICAÇÕES (${corpusPubs.length} fontes):
${aiCorpus || "(nenhuma)"}

Tarefas:
- \`majorTopics\`: 5-8 temas reais que aparecem nas manchetes/snippets.
- \`narratives\`: separe em apoio[], críticas[], debates[] (frases curtas com a ideia central de cada narrativa observada).
- \`positiveSignals\`, \`negativeSignals\`, \`neutralSignals\` (0..100, somando ~100) — estimativa do tom global das publicações.
- \`summary\`: 4-6 frases em português, prosa natural, descrevendo como o evento repercutiu nacionalmente. NUNCA invente o que não está nas publicações.
- \`timeline\`: distribua as publicações em "antes" (antes da data do evento), "durante" (dia do evento), "depois" (após). Retorne contagem por dia (date YYYY-MM-DD).

Responda APENAS com JSON válido:
{
  "majorTopics": ["..."],
  "narratives": { "apoio": ["..."], "criticas": ["..."], "debates": ["..."] },
  "positiveSignals": 35, "negativeSignals": 40, "neutralSignals": 25,
  "summary": "...",
  "timeline": [{ "date": "2026-05-19", "count": 3, "phase": "antes" }]
}`;

    let aiPayload: any = {};
    let aiAvailable = false;
    try {
      const ai = await callAICerebrasFirst({
        systemMsg: "Você é um analista político especialista em repercussão midiática. Responde apenas em JSON válido baseado SOMENTE nas publicações fornecidas.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 2200,
        temperature: 0.2,
        tag: "analyze-event-external",
      });
      const content = ai.content || "";
      try { aiPayload = JSON.parse(content); }
      catch { const m = content.match(/\{[\s\S]*\}/); if (m) aiPayload = JSON.parse(m[0]); }
      aiAvailable = true;
    } catch (e) {
      console.error("[analyze-event-regional] AI failed:", (e as Error).message);
    }

    // 5) Optional: internal reaction from platform comments (complement only)
    let internalReaction: any = { mentions: 0, positive: 0, negative: 0, neutral: 0, engagement: 0, sample: [] };
    try {
      const startISO = new Date(winStart).toISOString();
      const endISO = new Date(winEnd).toISOString();
      const kwOr = baseKeywords.length
        ? baseKeywords.slice(0, 4).map((k) => `comment_text.ilike.%${String(k).replace(/[,%]/g, "")}%`).join(",")
        : "";
      let query = admin.from("social_interactions")
        .select("comment_text, sentiment_label, likes_count, replies_count, region, social_network, original_posted_at, created_at")
        .eq("candidate_id", event.candidate_id)
        .or(`and(original_posted_at.gte.${startISO},original_posted_at.lte.${endISO}),and(original_posted_at.is.null,created_at.gte.${startISO},created_at.lte.${endISO})`);
      if (kwOr) query = query.or(kwOr);
      const { data: rows } = await query.limit(2000);
      const list = rows || [];
      let pos = 0, neg = 0, neu = 0, eng = 0;
      for (const r of list) {
        const s = (r.sentiment_label || "").toLowerCase();
        if (s.startsWith("pos")) pos++; else if (s.startsWith("neg")) neg++; else neu++;
        eng += (r.likes_count || 0) + (r.replies_count || 0);
      }
      const sample = list.sort((a: any, b: any) => (b.likes_count || 0) - (a.likes_count || 0)).slice(0, 6).map((r: any) => ({
        text: String(r.comment_text || "").slice(0, 240),
        sentiment: r.sentiment_label || "—",
        network: r.social_network || "—",
        likes: r.likes_count || 0,
      }));
      internalReaction = { mentions: list.length, positive: pos, negative: neg, neutral: neu, engagement: eng, sample };
    } catch (e) {
      console.warn("[analyze-event-regional] internal reaction skipped:", (e as Error).message);
    }

    // 6) Confidence (external-data centric)
    const distinctOutlets = new Set(corpusPubs.map((p) => p.outlet)).size;
    const distinctRegions = Object.values(regionalDistribution).filter((v) => v >= 5).length;
    const distinctDays = new Set(corpusPubs.map((p) => p.publishedAt?.slice(0, 10)).filter(Boolean)).size;
    let confScore = 0;
    confScore += Math.min(40, distinctOutlets * 5);
    confScore += Math.min(30, distinctRegions * 8);
    confScore += Math.min(30, distinctDays * 6);
    const confidence = {
      level: (confScore >= 70 ? "Alta" : confScore >= 40 ? "Média" : "Baixa") as "Alta" | "Média" | "Baixa",
      score: confScore,
      breakdown: {
        distinctOutlets, distinctRegions, distinctDays,
      },
    };

    // 7) Build response payload
    const payload = {
      event: {
        id: event.id,
        name: event.event_name,
        type: event.event_type,
        date: event.event_date,
        description: event.description,
        keywords: baseKeywords,
        location: event.metadata?.location || null,
        importanceScore: event.metadata?.importance_score || null,
      },
      externalRepercussion: {
        totalPublications: corpusPubs.length,
        estimatedReach,
        majorTopics: Array.isArray(aiPayload.majorTopics) ? aiPayload.majorTopics.slice(0, 10) : (event.metadata?.topics || []),
        regionalDistribution,
        positiveSignals: clamp(Number(aiPayload.positiveSignals) || 33),
        negativeSignals: clamp(Number(aiPayload.negativeSignals) || 33),
        neutralSignals: clamp(Number(aiPayload.neutralSignals) || 34),
        narratives: {
          apoio: arr(aiPayload?.narratives?.apoio),
          criticas: arr(aiPayload?.narratives?.criticas),
          debates: arr(aiPayload?.narratives?.debates),
        },
        sources: corpusPubs.slice(0, 40).map((p) => ({
          url: p.url, title: p.title, outlet: p.outlet, region: p.outletRegion,
          publishedAt: p.publishedAt || null, snippet: p.snippet,
        })),
        timeline: Array.isArray(aiPayload.timeline) ? aiPayload.timeline : buildTimeline(corpusPubs, event.event_date),
        summary: aiPayload.summary || "",
        aiAvailable,
      },
      internalReaction,
      confidence,
      debug: {
        publicationsCollected: pubs.length,
        publicationsInWindow: inWindow.length,
        usedForAnalysis: corpusPubs.length,
        sourcesByOutlet: Object.fromEntries(Array.from(corpusPubs.reduce((m, p) => { m.set(p.outlet, (m.get(p.outlet) || 0) + 1); return m; }, new Map<string, number>()))),
        eventWindow: { start: new Date(winStart).toISOString(), end: new Date(winEnd).toISOString() },
      },
    };

    // 8) Cache
    try {
      await admin.from("political_events").update({
        metadata: { ...(event.metadata || {}), external_cache: { savedAt: new Date().toISOString(), payload } },
      }).eq("id", event.id);
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[analyze-event-regional]", e);
    return jsonErr(500, (e as Error).message);
  }
});

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function clamp(n: number) { return Math.max(0, Math.min(100, Math.round(n))); }
function arr(x: any): string[] { return Array.isArray(x) ? x.filter((s) => typeof s === "string").slice(0, 6) : []; }

function buildTimeline(pubs: ExternalPublication[], eventDate: string): Array<{ date: string; count: number; phase: "antes" | "durante" | "depois" }> {
  const byDay = new Map<string, number>();
  for (const p of pubs) {
    const d = (p.publishedAt || "").slice(0, 10);
    if (!d) continue;
    byDay.set(d, (byDay.get(d) || 0) + 1);
  }
  const evDay = String(eventDate).slice(0, 10);
  return Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({
    date, count,
    phase: (date < evDay ? "antes" : date === evDay ? "durante" : "depois") as "antes" | "durante" | "depois",
  }));
}
