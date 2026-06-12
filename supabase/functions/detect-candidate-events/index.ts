// External-first event detector for a candidate.
// Sources: Firecrawl search (news/web/youtube) + GDELT (free, no auth).
// AI then groups publications into discrete events with structured metadata.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { firecrawlSearch, gdeltSearch, rssNewsSearch, dedupePublications, computeRegionalDistribution, estimatedReachOf, type ExternalPublication } from "../_shared/external-collector.ts";
import {
  classifySource as pipelineClassifySource,
  classifyCategory as pipelineCategory,
  computeConfidenceScore as pipelineConfidenceV2,
  dynamicThreshold as pipelineDynamicThreshold,
  type SourceTier,
} from "../_shared/peak-pipeline.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EVENT_TYPES = ["entrevista","debate","live","podcast","discurso","comicio","coletiva","agenda","evento","programa","declaracao","viagem","reuniao","crise","noticia"] as const;

interface DetectedEvent {
  title: string;
  description: string;
  eventType: string;
  date: string; // YYYY-MM-DD
  location?: string;
  entities?: string[];
  keywords: string[];
  topics?: string[];
  importanceScore: number; // 0..100
  sources: { name: string; url: string; region: string }[];
  estimatedReach: number;
  regionalDistribution: Record<string, number>;
}

function sanitize(s: unknown): string {
  if (s == null) return "";
  return String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const auth = req.headers.get("Authorization");
    if (!auth) return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Não autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { candidateId, monthsBack = 1 } = await req.json();
    if (!candidateId) return new Response(JSON.stringify({ error: "candidateId obrigatório" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: candidate } = await admin.from("candidates").select("id, full_name, party, user_id").eq("id", candidateId).maybeSingle();
    if (!candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const name = candidate.full_name;
    const partyPart = candidate.party ? ` (${candidate.party})` : "";
    const tbs = monthsBack <= 1 ? "qdr:m" : monthsBack <= 3 ? "qdr:m" : "qdr:y";

    // 1) Collect external publications in parallel
    const queries = [
      `"${name}" entrevista OR debate OR coletiva OR discurso`,
      `"${name}" agenda OR viagem OR reuniao OR evento OR comicio`,
      `"${name}" declaracao OR podcast OR live OR programa`,
      `"${name}" noticia OR crise OR repercussao`,
    ];

    const daysBack = Math.max(7, monthsBack * 31);
    const allResults = await Promise.all([
      ...queries.map((q) => firecrawlSearch(q, { limit: 10, tbs })),
      gdeltSearch(name, { maxRecords: 40, timespan: monthsBack <= 1 ? "1month" : "3months" }),
      rssNewsSearch(name, { limit: 60, daysBack }),
      rssNewsSearch(`${name} ${candidate.party || "política"}`, { limit: 30, daysBack }),
    ]);
    const pubs: ExternalPublication[] = dedupePublications(allResults.flat());
    console.log(`[detect-events] collected ${pubs.length} external publications for ${name}`);


    if (pubs.length === 0) {
      return new Response(JSON.stringify({
        events: [],
        message: "Nenhuma publicação externa encontrada. Tente novamente em alguns minutos ou verifique se o nome do candidato está completo.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Build compact corpus for AI grouping
    const corpus = pubs.slice(0, 60).map((p, i) =>
      `[${i + 1}] (${p.outlet}, ${p.publishedAt?.slice(0, 10) || "?"}) ${sanitize(p.title).slice(0, 160)} — ${sanitize(p.snippet).slice(0, 220)} | ${p.url}`
    ).join("\n");

    const prompt = `Você é um analista político brasileiro. Abaixo estão publicações reais (notícias, vídeos, posts) sobre **${name}${partyPart}** coletadas de jornais, sites e redes nos últimos ${monthsBack} mes(es).

Agrupe essas publicações em ACONTECIMENTOS REAIS (entrevistas, debates, discursos, viagens, agendas, coletivas, podcasts, lives, reuniões, crises, ou notícias relevantes). Um acontecimento = um fato concreto coberto por uma ou mais fontes.

REGRAS:
- NÃO crie "Pico de menções", "Aumento de comentários" ou itens genéricos.
- Cada evento precisa de NOME real e identificável (ex.: "Entrevista no Jornal Nacional", "Comício em Salvador").
- \`eventType\`: um de ${EVENT_TYPES.join(", ")}.
- \`importanceScore\` (0-100): quantidade de fontes, alcance dos veículos, magnitude do tema.
- \`date\` (YYYY-MM-DD): data do acontecimento, não data de publicação.
- \`keywords\`: 4-8 termos curtos do evento.
- \`topics\`: 2-5 temas amplos (ex.: "economia", "internacional", "BRICS").
- \`entities\`: pessoas/instituições mencionadas além do candidato.
- \`narratives\`: opcional. Objeto com 3 chaves opcionais — "apoio" (frases curtas de defesa/elogio), "criticas" (frases de crítica), "debates" (frases neutras de discussão). Cada lista com até 5 itens curtos extraídos das publicações.
- \`sourceIndices\`: lista de índices [1..N] das publicações que cobrem ESTE evento.

PUBLICAÇÕES:
${corpus}

Responda APENAS com JSON válido (sem markdown):
{
  "events": [
    {
      "title": "Entrevista no Jornal Nacional",
      "description": "Resumo em 1-2 frases.",
      "eventType": "entrevista",
      "date": "2026-05-20",
      "location": "São Paulo, SP",
      "entities": ["William Bonner", "Globo"],
      "keywords": ["jornal nacional", "JN", "bonner"],
      "topics": ["economia", "midia"],
      "narratives": { "apoio": ["..."], "criticas": ["..."], "debates": ["..."] },
      "importanceScore": 78,
      "sourceIndices": [1, 4, 9]
    }
  ]
}`;

    let aiResult: { events: any[] } = { events: [] };
    try {
      const ai = await callAICerebrasFirst({
        systemMsg: "Você é um analista político que agrupa publicações reais em acontecimentos concretos. NUNCA cria itens genéricos. Responde apenas em JSON válido.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 4000,
        temperature: 0.15,
        tag: "detect-events-external",
      });
      const content = ai.content || "";
      try { aiResult = JSON.parse(content); }
      catch { const m = content.match(/\{[\s\S]*\}/); if (m) aiResult = JSON.parse(m[0]); }
      console.log(`[detect-events] ✅ ${ai.provider}:${ai.model} → ${aiResult.events?.length || 0} eventos`);
    } catch (e) {
      console.error("[detect-events] AI failed:", (e as Error).message);
    }

    // 3) Materialize each event with its real publications + regional distribution + quality scoring
    const events: (DetectedEvent & {
      distinctOutlets: number;
      publicationsCount: number;
      confidenceScore: number;
      themes: string[];
      narratives: { apoio: string[]; criticas: string[]; debates: string[] };
      lowCoverage: boolean;
    })[] = (aiResult.events || []).map((ev: any) => {
      const indices: number[] = Array.isArray(ev.sourceIndices) ? ev.sourceIndices.map((n: any) => Number(n) - 1).filter((n: number) => n >= 0 && n < pubs.length) : [];
      const evPubs = indices.map((i) => pubs[i]).filter(Boolean);
      const sources = evPubs.map((p) => ({ name: p.outlet, url: p.url, region: p.outletRegion }));
      const dist = computeRegionalDistribution(evPubs.length ? evPubs : pubs.slice(0, 5));
      const reach = estimatedReachOf(evPubs);
      const type = String(ev.eventType || "noticia").toLowerCase();

      // Coverage quality metrics
      const distinctOutlets = new Set(evPubs.map((p) => (p.outlet || "").toLowerCase()).filter(Boolean)).size;
      const publicationsCount = evPubs.length;
      // Confidence = blend of distinct outlets (0..1 at 5+), publications (0..1 at 8+), regions covered (0..1 at 3+)
      const regionsCovered = Object.values(dist).filter((v) => Number(v) > 0).length;
      const cOutlets = Math.min(distinctOutlets / 5, 1);
      const cPubs = Math.min(publicationsCount / 8, 1);
      const cRegions = Math.min(regionsCovered / 3, 1);
      const confidenceScore = Number((cOutlets * 0.45 + cPubs * 0.35 + cRegions * 0.2).toFixed(3));

      // Themes (broad) and narratives (raw quotes split by tone)
      const themes: string[] = Array.isArray(ev.topics) ? ev.topics.slice(0, 6) : [];
      const narratives = (ev.narratives && typeof ev.narratives === "object")
        ? {
            apoio: Array.isArray(ev.narratives.apoio) ? ev.narratives.apoio.slice(0, 5) : [],
            criticas: Array.isArray(ev.narratives.criticas) ? ev.narratives.criticas.slice(0, 5) : [],
            debates: Array.isArray(ev.narratives.debates) ? ev.narratives.debates.slice(0, 5) : [],
          }
        : { apoio: [], criticas: [], debates: [] };

      // Coverage thresholds: at least 1 publication. Single-source events are still surfaced.
      const lowCoverage = !(distinctOutlets >= 1 && publicationsCount >= 1);


      return {
        title: String(ev.title || "").trim().slice(0, 200),
        description: String(ev.description || "").trim().slice(0, 600),
        eventType: (EVENT_TYPES as readonly string[]).includes(type) ? type : "noticia",
        date: String(ev.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10),
        location: ev.location || undefined,
        entities: Array.isArray(ev.entities) ? ev.entities.slice(0, 10) : [],
        keywords: Array.isArray(ev.keywords) ? ev.keywords.slice(0, 10) : [],
        topics: themes,
        importanceScore: Math.max(0, Math.min(100, Number(ev.importanceScore) || 50)),
        sources,
        estimatedReach: reach,
        regionalDistribution: dist,
        distinctOutlets,
        publicationsCount,
        confidenceScore,
        themes,
        narratives,
        lowCoverage,
      };
    }).filter((e) => e.title && e.sources.length > 0)
      .sort((a, b) => b.importanceScore - a.importanceScore);

    // 4) Persist (reuse existing if title+date match within 3 days)
    const { data: existing } = await admin
      .from("political_events").select("id, event_name, event_date, event_type, metadata")
      .eq("candidate_id", candidateId).eq("user_id", user.id);
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    const findExisting = (ev: { title: string; date: string }) => {
      const evN = norm(ev.title);
      const evT = new Date(`${ev.date}T12:00:00Z`).getTime();
      return (existing || []).find((r: any) => {
        const rT = new Date(r.event_date).getTime();
        return Math.abs(rT - evT) <= 3 * 86400000 && (norm(r.event_name) === evN || norm(r.event_name).includes(evN.slice(0, 20)));
      });
    };

    const saved: any[] = [];
    for (const ev of events) {
      const qualityCols = {
        low_coverage: ev.lowCoverage,
        confidence_score: ev.confidenceScore,
        importance_score: ev.importanceScore,
        distinct_outlets: ev.distinctOutlets,
        publications_count: ev.publicationsCount,
        themes: ev.themes,
        narratives: ev.narratives,
      };
      const match = findExisting(ev);
      if (match) {
        await admin.from("political_events").update({
          description: ev.description || null,
          keywords: ev.keywords,
          ...qualityCols,
          metadata: {
            ...(match.metadata || {}),
            external_sources: ev.sources,
            estimated_reach: ev.estimatedReach,
            importance_score: ev.importanceScore,
            regional_distribution: ev.regionalDistribution,
            topics: ev.topics,
            entities: ev.entities,
            location: ev.location || null,
            category: "evento",
            external_first: true,
            updated_at: new Date().toISOString(),
          },
        }).eq("id", match.id);
        saved.push({ ...match, ...ev });
      } else {
        const { data: inserted, error } = await admin.from("political_events").insert({
          user_id: user.id,
          candidate_id: candidateId,
          event_name: ev.title,
          event_type: ev.eventType,
          event_date: new Date(`${ev.date}T12:00:00Z`).toISOString(),
          description: ev.description || null,
          keywords: ev.keywords,
          ...qualityCols,
          metadata: {
            external_sources: ev.sources,
            estimated_reach: ev.estimatedReach,
            importance_score: ev.importanceScore,
            regional_distribution: ev.regionalDistribution,
            topics: ev.topics,
            entities: ev.entities,
            location: ev.location || null,
            category: "evento",
            external_first: true,
            auto_detected: true,
          },
        }).select("id, event_name, event_type, event_date, keywords, metadata, description").maybeSingle();
        if (error) console.error("[detect-events] insert error:", error.message);
        if (inserted) saved.push(inserted);
      }
    }

    // Clean legacy "pico" events
    try {
      await admin.from("political_events").delete().eq("candidate_id", candidateId).eq("user_id", user.id).eq("event_type", "pico");
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({
      events: saved,
      saved_count: saved.length,
      candidate: { id: candidate.id, full_name: candidate.full_name },
      publications_collected: pubs.length,
      sources_breakdown: {
        firecrawl: pubs.filter((p) => p.source === "firecrawl").length,
        gdelt: pubs.filter((p) => p.source === "gdelt").length,
        rss: pubs.filter((p) => p.source === "rss").length,
      },

    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[detect-events] error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
