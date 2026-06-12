// resolve-peak-cause
// On-demand explanation for a single detected peak.
// Combines internal SSOT evidence (social_interactions) with external news
// (Google News / Bing RSS + GDELT) and asks the AI to explain the cause.
//
// Input:  { candidateId, candidateName, peakDate, windowStart?, windowEnd?, peakMentions? }
// Output: { event_title, event_summary, root_cause, confidence, main_networks,
//           main_entities, top_keywords, top_hashtags, top_domains, sentiment_summary,
//           external_evidence: [{title,url,outlet,publishedAt}], internal_mentions, fallback_text? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { rssNewsSearch, gdeltSearch, dedupePublications, type ExternalPublication } from "../_shared/external-collector.ts";

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

    const external_evidence = pubs.map((p) => ({
      title: p.title, url: p.url, outlet: p.outlet, publishedAt: p.publishedAt,
    }));

    // ---------- STAGE 3: AI explanation ----------
    const systemMsg = `Você é um analista político brasileiro. Sua tarefa é EXPLICAR a causa de um pico de menções a um candidato.
REGRAS CRÍTICAS:
- Baseie-se APENAS nas evidências fornecidas (internas e externas).
- NUNCA invente eventos, datas, prisões, operações, CPIs ou decisões judiciais que não estejam nas evidências.
- Se as evidências forem fracas ou ambíguas, retorne confidence < 0.6 e seja honesto na explicação.
- Responda APENAS em JSON válido, em português brasileiro.`;

    const userPrompt = `CANDIDATO: ${candidateName}
DATA DO PICO: ${peakDate}
JANELA: ${wStart.toISOString().slice(0,10)} → ${wEnd.toISOString().slice(0,10)}
PICO DE MENÇÕES: ${peakMentions ?? "n/d"}

EVIDÊNCIA INTERNA (extraída de ${interactions.length} interações monitoradas):
- Top palavras: ${evidence.top_keywords.slice(0,12).map(k=>`${k.term}(${k.count})`).join(", ") || "—"}
- Top hashtags: ${evidence.top_hashtags.slice(0,8).map(k=>`#${k.term}(${k.count})`).join(", ") || "—"}
- Top menções (@): ${evidence.top_mentions.slice(0,6).map(k=>`@${k.term}(${k.count})`).join(", ") || "—"}
- Top bigramas: ${evidence.top_bigrams.slice(0,8).map(k=>`"${k.term}"(${k.count})`).join(", ") || "—"}
- Redes principais: ${evidence.top_networks.map(k=>`${k.network}(${k.count})`).join(", ") || "—"}
- Domínios mais citados: ${evidence.top_domains.slice(0,6).map(k=>`${k.domain}(${k.count})`).join(", ") || "—"}
- Sentimento: ${sentiment_summary}

EVIDÊNCIA EXTERNA (${external_evidence.length} publicações encontradas):
${external_evidence.slice(0,15).map((e,i)=>`${i+1}. [${e.outlet}] ${e.title}${e.publishedAt?` (${e.publishedAt.slice(0,10)})`:""}`).join("\n") || "Nenhuma publicação externa relevante."}

Responda em JSON estrito com este schema:
{
  "event_title": "título curto e factual do acontecimento (até 90 caracteres)",
  "event_summary": "1-2 frases descrevendo o que aconteceu, baseado nas evidências",
  "root_cause": "explicação da causa do pico de menções",
  "confidence": 0.0,
  "main_networks": ["..."],
  "main_entities": ["pessoas, instituições ou termos mais relevantes"],
  "sentiment_summary": "resumo qualitativo do sentimento das redes"
}`;

    let ai: any = null;
    let aiError: string | null = null;
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

    const confidence = Number(ai?.confidence ?? 0);
    const lowConfidence = !ai || confidence < 0.6;
    const topTermsList = evidence.top_keywords.slice(0, 6).map((k) => k.term).join(", ");
    const fallback_text = lowConfidence
      ? `Não encontramos evidências externas suficientes para determinar com alta confiança a causa deste pico. Principais termos associados nas redes monitoradas: ${topTermsList || "—"}.`
      : null;

    const out = {
      event_title: ai?.event_title || `Pico de menções em ${peakDate}`,
      event_summary: ai?.event_summary || "",
      root_cause: ai?.root_cause || "",
      confidence: Number.isFinite(confidence) ? confidence : 0,
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
