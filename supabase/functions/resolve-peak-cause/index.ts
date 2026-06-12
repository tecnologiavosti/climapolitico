// resolve-peak-cause
// On-demand explanation for a single detected peak.
// Combines internal SSOT evidence (social_interactions) with external news
// (Google News / Bing RSS + GDELT) and asks the AI to explain the cause.
//
// Input:  { candidateId, candidateName, peakDate, windowStart?, windowEnd?, peakMentions? }
// Output: { response_mode, event_title, event_summary, root_cause, confidence, main_networks,
//           main_entities, top_keywords, top_hashtags, top_domains, sentiment_summary,
//           external_evidence: [{title,url,outlet,publishedAt}], internal_mentions, fallback_text? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { rssNewsSearch, gdeltSearch, dedupePublications, type ExternalPublication } from "../_shared/external-collector.ts";
import { confidenceFromSources as pipelineConfidence, classifyCategory as pipelineCategory, classifySource as pipelineClassifySource } from "../_shared/peak-pipeline.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ---------- text mining helpers ----------
const STOPWORDS = new Set<string>([
  "a","o","os","as","de","da","do","das","dos","e","ou","que","com","para","por","em","no","na","nos","nas",
  "um","uma","uns","umas","se","sua","seu","suas","seus","ao","aos","ser","foi","era","mais","menos","muito","já",
  "também","sobre","entre","como","quando","onde","quem","qual","quais","isso","esse","essa","esta","este","isto",
  "mas","porque","porém","então","só","tem","tinha","ter","sim","não","https","http","www","com.br","via","rt",
  "the","of","and","to","in","on","for","is","at","be","by","this","that","with","from","you","your","are","was",
]);

function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9áéíóúâêôãõç #@_-]/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function topN(map: Map<string, number>, n: number): Array<[string, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

type SourceStrength = "strong" | "weak";
type ResponseMode = "CONFIRMED_EVENT" | "PROBABLE_NARRATIVE" | "UNKNOWN_TRIGGER";

const WEAK_SOURCE_RE = /(^|\.)(instagram\.com|facebook\.com|m\.facebook\.com|fb\.com|youtube\.com|youtu\.be|tiktok\.com|threads\.net|threads\.com|x\.com|twitter\.com|t\.me|telegram\.me|reddit\.com|pinterest\.com|bsky\.app|mastodon\.|truthsocial\.com)$/i;
const WEAK_OUTLET_RE = /\b(instagram|facebook|youtube|tiktok|threads|twitter|x\.com|telegram|reddit|pinterest|bluesky|bsky|mastodon|truth social)\b/i;
const STRONG_OFFICIAL_RE = /(^|\.)(stf\.jus\.br|tse\.jus\.br|senado\.leg\.br|camara\.leg\.br|gov\.br|planalto\.gov\.br|mpf\.mp\.br|pf\.gov\.br|tcu\.gov\.br)$/i;
const STRONG_NEWS_RE = /(^|\.)(g1\.globo\.com|oglobo\.globo\.com|valor\.globo\.com|folha\.uol\.com\.br|estadao\.com\.br|uol\.com\.br|poder360\.com\.br|cnnbrasil\.com\.br|metropoles\.com|reuters\.com|bbc\.com|veja\.abril\.com\.br|terra\.com\.br|r7\.com|band\.uol\.com\.br|congressoemfoco\.uol\.com\.br|cartacapital\.com\.br|nexojornal\.com\.br|brasildefato\.com\.br|agenciabrasil\.ebc\.com\.br)$/i;
const STRONG_OUTLET_RE = /\b(g1|globo|o globo|valor|folha|estad[aã]o|uol|poder360|cnn|metropoles|m[eé]tropoles|reuters|bbc|veja|terra|r7|band|record|jovem pan|congresso em foco|carta ?capital|nexo|brasil de fato|ag[êe]ncia brasil|senado|c[aâ]mara|stf|tse|planalto|pol[ií]cia federal|pf|mpf|tcu)\b/i;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}

function classifyExternalSource(pub: ExternalPublication): SourceStrength {
  const host = hostOf(pub.url || "");
  const outlet = String(pub.outlet || "");
  if (WEAK_SOURCE_RE.test(host) || WEAK_OUTLET_RE.test(outlet)) return "weak";
  if (STRONG_OFFICIAL_RE.test(host) || STRONG_NEWS_RE.test(host) || STRONG_OUTLET_RE.test(outlet)) return "strong";
  if (pub.source === "gdelt") return "strong";
  if (pub.source === "rss" && outlet && !WEAK_OUTLET_RE.test(outlet)) return "strong";
  return "weak";
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function calculateSemanticConfidence(evidence: ReturnType<typeof extractEvidence>, interactionsCount: number): number {
  const keywordTotal = evidence.top_keywords.reduce((acc, k) => acc + k.count, 0);
  const topKeyword = evidence.top_keywords[0]?.count ?? 0;
  const dominance = keywordTotal > 0 ? clamp01((topKeyword / keywordTotal) * 3) : 0;
  const minRepeated = Math.max(3, Math.floor(interactionsCount * 0.01));
  const keywordDepth = clamp01(evidence.top_keywords.filter((k) => k.count >= minRepeated).length / 8);
  const bigramSignal = clamp01(evidence.top_bigrams.filter((k) => k.count >= Math.max(3, Math.floor(interactionsCount * 0.006))).length / 4);
  const hashtagSignal = clamp01(evidence.top_hashtags.filter((k) => k.count >= Math.max(3, Math.floor(interactionsCount * 0.004))).length / 3);
  return clamp01(dominance * 0.30 + keywordDepth * 0.30 + bigramSignal * 0.25 + hashtagSignal * 0.15);
}

function calculateEntityConfidence(evidence: ReturnType<typeof extractEvidence>, interactionsCount: number): number {
  const minEntity = Math.max(3, Math.floor(interactionsCount * 0.005));
  const mentionedEntities = evidence.top_mentions.filter((k) => k.count >= minEntity).length;
  const namedBigrams = evidence.top_bigrams.filter((k) => /\b(stf|tse|senado|camara|câmara|trump|eua|pf|lula|bolsonaro|ministro|congresso)\b/i.test(k.term) || k.count >= minEntity).length;
  return clamp01((mentionedEntities / 5) * 0.55 + (namedBigrams / 6) * 0.45);
}

function buildTopicLabel(evidence: ReturnType<typeof extractEvidence>): string {
  const terms = [
    ...evidence.top_bigrams.slice(0, 2).map((k) => k.term),
    ...evidence.top_keywords.slice(0, 4).map((k) => k.term),
  ].filter(Boolean);
  return terms.length ? terms.slice(0, 5).join(", ") : "termos recorrentes nas redes";
}

function extractEvidence(rows: Array<{ comment_text?: string | null; post_title?: string | null; social_network?: string | null; post_url?: string | null }>) {
  const keywords = new Map<string, number>();
  const hashtags = new Map<string, number>();
  const mentions = new Map<string, number>();
  const domains = new Map<string, number>();
  const networks = new Map<string, number>();
  const bigrams = new Map<string, number>();

  for (const r of rows) {
    const text = `${r.post_title || ""} ${r.comment_text || ""}`.trim();
    if (r.social_network) networks.set(r.social_network, (networks.get(r.social_network) || 0) + 1);
    if (r.post_url) {
      try {
        const d = new URL(r.post_url).hostname.replace(/^www\./, "");
        domains.set(d, (domains.get(d) || 0) + 1);
      } catch { /* ignore */ }
    }
    const toks = tokenize(text);
    let prev: string | null = null;
    for (const t of toks) {
      if (t.startsWith("#")) {
        const h = t.slice(1);
        if (h.length >= 3) hashtags.set(h, (hashtags.get(h) || 0) + 1);
      } else if (t.startsWith("@")) {
        const m = t.slice(1);
        if (m.length >= 3) mentions.set(m, (mentions.get(m) || 0) + 1);
      } else if (t.length >= 4 && !STOPWORDS.has(t) && !/^\d+$/.test(t)) {
        keywords.set(t, (keywords.get(t) || 0) + 1);
        if (prev && prev.length >= 4) {
          const bg = `${prev} ${t}`;
          bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
        }
        prev = t;
      } else {
        prev = null;
      }
    }
  }
  return {
    top_keywords: topN(keywords, 20).map(([k, v]) => ({ term: k, count: v })),
    top_hashtags: topN(hashtags, 15).map(([k, v]) => ({ term: k, count: v })),
    top_mentions: topN(mentions, 15).map(([k, v]) => ({ term: k, count: v })),
    top_domains: topN(domains, 10).map(([k, v]) => ({ domain: k, count: v })),
    top_networks: topN(networks, 10).map(([k, v]) => ({ network: k, count: v })),
    top_bigrams: topN(bigrams, 10).map(([k, v]) => ({ term: k, count: v })),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const { candidateId, candidateName, peakDate, windowStart, windowEnd, peakMentions } = body as {
      candidateId?: string;
      candidateName?: string;
      peakDate?: string;
      windowStart?: string;
      windowEnd?: string;
      peakMentions?: number;
    };
    if (!candidateId || !candidateName || !peakDate) {
      return new Response(JSON.stringify({ error: "candidateId, candidateName, peakDate são obrigatórios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const peak = new Date(`${peakDate}T12:00:00Z`);
    const wStart = windowStart ? new Date(`${windowStart}T00:00:00Z`) : new Date(peak.getTime() - 7 * 86400_000);
    const wEnd = windowEnd ? new Date(`${windowEnd}T23:59:59Z`) : new Date(peak.getTime() + 7 * 86400_000);

    const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

    // ---------- STAGE 1: internal SSOT evidence ----------
    const { data: rows, error: qErr } = await supa
      .from("social_interactions")
      .select("comment_text, post_title, social_network, post_url, sentiment_label")
      .eq("candidate_id", candidateId)
      .gte("original_posted_at", wStart.toISOString())
      .lte("original_posted_at", wEnd.toISOString())
      .limit(3000);

    if (qErr) console.warn("[resolve-peak-cause] internal query error", qErr.message);
    const interactions = rows || [];
    const evidence = extractEvidence(interactions);

    // sentiment summary
    let pos = 0, neg = 0, neu = 0;
    for (const r of interactions) {
      const s = (r as any).sentiment_label;
      if (s === "positive") pos++;
      else if (s === "negative") neg++;
      else if (s === "neutral") neu++;
    }
    const totalSent = pos + neg + neu;
    const sentiment_summary = totalSent
      ? `${Math.round((pos / totalSent) * 100)}% positivo · ${Math.round((neu / totalSent) * 100)}% neutro · ${Math.round((neg / totalSent) * 100)}% negativo`
      : "Sentimento indisponível";

    // ---------- STAGE 2: external evidence ----------
    const topTermsForQuery = evidence.top_keywords.slice(0, 4).map((k) => k.term).join(" ");
    const queries = [
      `${candidateName}`,
      topTermsForQuery ? `${candidateName} ${topTermsForQuery}` : null,
      evidence.top_hashtags[0] ? `${candidateName} #${evidence.top_hashtags[0].term}` : null,
    ].filter(Boolean) as string[];

    const daysBack = Math.max(7, Math.ceil((Date.now() - wStart.getTime()) / 86400_000));
    const externalResults = await Promise.allSettled([
      ...queries.map((q) => rssNewsSearch(q, { limit: 25, daysBack })),
      gdeltSearch(`"${candidateName}"`, { maxRecords: 30, timespan: `${Math.min(90, daysBack)}d` }),
    ]);
    let pubs: ExternalPublication[] = [];
    for (const r of externalResults) if (r.status === "fulfilled") pubs.push(...r.value);

    // filter to window ±3d for relevance, keep candidate name match
    const lowerCand = candidateName.toLowerCase().split(/\s+/).filter((p) => p.length > 3);
    const wStartLoose = new Date(wStart.getTime() - 3 * 86400_000);
    const wEndLoose = new Date(wEnd.getTime() + 3 * 86400_000);
    pubs = dedupePublications(pubs).filter((p) => {
      const blob = `${p.title} ${p.snippet}`.toLowerCase();
      if (!lowerCand.some((part) => blob.includes(part))) return false;
      if (!p.publishedAt) return true;
      const d = new Date(p.publishedAt);
      return d >= wStartLoose && d <= wEndLoose;
    }).slice(0, 25);

    // === NEW PIPELINE: tier-weighted source confidence ===
    const pipelinePubs = pubs.map((p) => ({ url: p.url || "", outlet: p.outlet || "" }));
    const pipelineConf = pipelineConfidence(pipelinePubs);
    const strongSources = pipelineConf.trusted_sources_count; // tier1 + tier2
    const weakSources = pipelineConf.tier_breakdown.tier4;
    const independentStrongSources = pipelineConf.independent_strong_sources;
    const confidenceWeightSum = pipelineConf.weight_sum;

    const classifiedPubs = pubs.map((p) => {
      const c = pipelineClassifySource(p.url || "", p.outlet || "");
      const strength: SourceStrength = (c.tier === "tier1" || c.tier === "tier2") ? "strong" : "weak";
      return { pub: p, strength, tier: c.tier, weight: c.weight };
    });

    const semanticConfidence = calculateSemanticConfidence(evidence, interactions.length);
    const entityConfidence = calculateEntityConfidence(evidence, interactions.length);
    const externalEvidenceConfidence = Math.min(1, confidenceWeightSum / 3);

    // Status from pipeline (hard rule: indeterminate => no AI factual claims)
    const pipelineStatus = pipelineConf.status; // "confirmed" | "probable" | "indeterminate"
    const responseMode: ResponseMode =
      pipelineStatus === "confirmed" ? "CONFIRMED_EVENT" :
      pipelineStatus === "probable" ? "PROBABLE_NARRATIVE" : "UNKNOWN_TRIGGER";

    const computedConfidence = Math.round(
      clamp01(
        semanticConfidence * 0.25 +
        entityConfidence * 0.15 +
        externalEvidenceConfidence * 0.60,
      ) * 100,
    ) / 100;
    const finalConfidence =
      pipelineStatus === "confirmed" ? Math.max(0.75, computedConfidence) :
      pipelineStatus === "probable" ? Math.min(0.74, Math.max(0.45, computedConfidence)) :
      Math.min(0.39, computedConfidence);
    const shouldDisplay = pipelineStatus !== "indeterminate";

    const external_evidence = classifiedPubs.map(({ pub, strength, tier, weight }) => ({
      title: pub.title, url: pub.url, outlet: pub.outlet, publishedAt: pub.publishedAt,
      source_strength: strength, tier, weight,
    }));

    // ---------- STAGE 3: AI explanation ----------
    const systemMsg = `Você é um analista político factual.

IMPORTANTE:
- Nunca invente eventos.
- Nunca infira encontros, decisões ou declarações sem evidência externa.
- Use APENAS as evidências fornecidas.
- Se houver menos de 2 fontes confiáveis independentes (domínios distintos de veículos jornalísticos ou órgãos oficiais), responda obrigatoriamente com category="Indeterminado", title="Causa indeterminada", shouldDisplay=false.
- Redes sociais (Instagram, Facebook, X, TikTok, YouTube, Telegram, Threads) NÃO contam como fonte confiável.
- MODE A CONFIRMED_EVENT (>=2 fontes fortes independentes): pode afirmar o evento citado pelas fontes.
- MODE B PROBABLE_NARRATIVE (1 fonte forte + sinal semântico forte): use linguagem probabilística ("os dados sugerem", "parece relacionado").
- MODE C UNKNOWN_TRIGGER: responda "Causa indeterminada".
- Responda APENAS em JSON válido, em português brasileiro.`;

    const userPrompt = `CANDIDATO: ${candidateName}
DATA DO PICO: ${peakDate}
JANELA: ${wStart.toISOString().slice(0,10)} → ${wEnd.toISOString().slice(0,10)}
PICO DE MENÇÕES: ${peakMentions ?? "n/d"}
MODO OBRIGATÓRIO: ${responseMode}
FONTES FORTES (total): ${strongSources}
FONTES FORTES INDEPENDENTES (domínios distintos): ${independentStrongSources}
FONTES FRACAS (redes sociais): ${weakSources}
CONFIANÇA SEMÂNTICA: ${semanticConfidence.toFixed(2)}
CONFIANÇA DE ENTIDADES: ${entityConfidence.toFixed(2)}
CONFIANÇA DE EVIDÊNCIA EXTERNA: ${externalEvidenceConfidence.toFixed(2)}
CONFIANÇA FINAL JÁ CALCULADA PELO SISTEMA: ${finalConfidence.toFixed(2)}

EVIDÊNCIA INTERNA (extraída de ${interactions.length} interações monitoradas):
- Top palavras: ${evidence.top_keywords.slice(0,12).map(k=>`${k.term}(${k.count})`).join(", ") || "—"}
- Top hashtags: ${evidence.top_hashtags.slice(0,8).map(k=>`#${k.term}(${k.count})`).join(", ") || "—"}
- Top menções (@): ${evidence.top_mentions.slice(0,6).map(k=>`@${k.term}(${k.count})`).join(", ") || "—"}
- Top bigramas: ${evidence.top_bigrams.slice(0,8).map(k=>`"${k.term}"(${k.count})`).join(", ") || "—"}
- Redes principais: ${evidence.top_networks.map(k=>`${k.network}(${k.count})`).join(", ") || "—"}
- Domínios mais citados: ${evidence.top_domains.slice(0,6).map(k=>`${k.domain}(${k.count})`).join(", ") || "—"}
- Sentimento: ${sentiment_summary}

EVIDÊNCIA EXTERNA (${external_evidence.length} publicações encontradas):
${external_evidence.slice(0,15).map((e,i)=>`${i+1}. [${e.source_strength.toUpperCase()} · ${e.outlet}] ${e.title}${e.publishedAt?` (${e.publishedAt.slice(0,10)})`:""}`).join("\n") || "Nenhuma publicação externa relevante."}

Responda em JSON estrito com este schema:
{
  "category": "STF | TSE | Operação PF | CPI | Julgamento | Escândalo | Debate | Eleições | Outros | Indeterminado",
  "title": "MODE A: título factual citado por >=2 fontes fortes; MODE B: título probabilístico; MODE C: 'Causa indeterminada'",
  "summary": "MODE A: o que aconteceu segundo fontes fortes; MODE B/C: padrão observado sem afirmar acontecimento factual",
  "confidence": 0.0,
  "shouldDisplay": true,
  "root_cause": "explicação respeitando o modo obrigatório",
  "main_networks": ["..."],
  "main_entities": ["pessoas, instituições ou termos mais relevantes"],
  "sentiment_summary": "resumo qualitativo do sentimento das redes"
}`;

    let ai: any = null;
    let aiError: string | null = null;
    if (responseMode !== "UNKNOWN_TRIGGER") {
      try {
        const res = await callAICerebrasFirst({
          systemMsg, userPrompt, jsonMode: true,
          maxTokens: 900, temperature: 0.2, tag: "resolve-peak-cause",
        });
        ai = JSON.parse(res.content);
      } catch (e) {
        aiError = (e as Error).message;
        console.warn("[resolve-peak-cause] AI failed:", aiError);
      }
    }

    const topTermsList = evidence.top_keywords.slice(0, 6).map((k) => k.term).join(", ");
    const topicLabel = buildTopicLabel(evidence);
    const unknownText = "Não foi possível identificar com confiança a causa exata do pico.";
    const probableText = `Os dados sugerem que o pico está relacionado a discussões sobre ${topicLabel}, porém não encontramos confirmação externa suficiente para determinar o gatilho exato.`;
    const lowConfidence = responseMode === "UNKNOWN_TRIGGER";
    const modeFallback = responseMode === "UNKNOWN_TRIGGER" ? unknownText : probableText;
    const safeTitle = responseMode === "CONFIRMED_EVENT"
      ? (ai?.title || ai?.event_title || `Pico de menções em ${peakDate}`)
      : responseMode === "PROBABLE_NARRATIVE"
        ? (ai?.title || `Narrativa provável: ${topicLabel}`)
        : "Causa indeterminada";
    const safeSummary = responseMode === "CONFIRMED_EVENT"
      ? (ai?.summary || ai?.event_summary || "")
      : modeFallback;
    const safeRootCause = responseMode === "CONFIRMED_EVENT"
      ? (ai?.root_cause || "")
      : `${modeFallback}${topTermsList ? ` Principais termos associados: ${topTermsList}.` : ""}`;
    const safeCategory = responseMode === "UNKNOWN_TRIGGER"
      ? "Indeterminado"
      : (ai?.category || "Outros");
    const shouldDisplayFinal = responseMode === "UNKNOWN_TRIGGER"
      ? false
      : (typeof ai?.shouldDisplay === "boolean" ? ai.shouldDisplay : shouldDisplay);
    const fallback_text = lowConfidence
      ? `${unknownText} Principais termos associados nas redes monitoradas: ${topTermsList || "—"}.`
      : null;

    console.log(JSON.stringify({
      tag: "resolve_peak_cause_grounding",
      candidateName,
      peakDate,
      response_mode: responseMode,
      strong_sources: strongSources,
      independent_strong_sources: independentStrongSources,
      weak_sources: weakSources,
      semantic_confidence: semanticConfidence,
      entity_confidence: entityConfidence,
      external_evidence_confidence: externalEvidenceConfidence,
      final_confidence: finalConfidence,
      should_display: shouldDisplayFinal,
    }));

    const out = {
      response_mode: responseMode,
      category: safeCategory,
      title: safeTitle,
      summary: safeSummary,
      confidence: finalConfidence,
      shouldDisplay: shouldDisplayFinal,
      // legacy fields kept for backward compatibility with UI
      event_title: safeTitle,
      event_summary: safeSummary,
      root_cause: safeRootCause,
      confidence_breakdown: {
        semanticConfidence,
        entityConfidence,
        externalEvidenceConfidence,
        strongSources,
        independentStrongSources,
        weakSources,
      },
      main_networks: ai?.main_networks || evidence.top_networks.map((n) => n.network),
      main_entities: ai?.main_entities || evidence.top_bigrams.slice(0, 6).map((b) => b.term),
      top_keywords: evidence.top_keywords.slice(0, 12),
      top_hashtags: evidence.top_hashtags.slice(0, 8),
      top_domains: evidence.top_domains.slice(0, 6),
      sentiment_summary: ai?.sentiment_summary || sentiment_summary,
      internal_mentions: interactions.length,
      external_evidence,
      fallback_text,
      ai_error: aiError,
      elapsed_ms: Date.now() - started,
    };

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[resolve-peak-cause] fatal", (e as Error).message, (e as Error).stack);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
