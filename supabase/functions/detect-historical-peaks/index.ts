// IA histórica para "Picos de Menções": descobre acontecimentos políticos reais
// cruzando imprensa, vídeos, decisões, eleições e a série local de menções.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";
import { firecrawlSearch, dedupePublications, estimatedReachOf, type ExternalPublication } from "../_shared/external-collector.ts";
import { buildContextualQueries } from "../_shared/politician-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type TimelinePoint = { date: string; count: number; isPeak?: boolean };

const EVENT_TERMS = [
  "eleição", "debate", "entrevista", "discurso", "coletiva", "posse", "decisão judicial", "STF", "TSE",
  "CPI", "operação policial", "votação", "Congresso", "Senado", "Câmara", "campanha", "segundo turno",
  "primeiro turno", "julgamento", "pronunciamento", "comício", "sabatina", "BRICS", "governo", "ministério",
];

function cleanText(value: unknown): string {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<video[\s\S]*?<\/video>/gi, " ")
    .replace(/<source[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(src|href|class|target|rel|nofollow|width|height|type)=\S+/gi, " ")
    .replace(/[{}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlValue(value: unknown): string {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .trim();
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function parseDate(value: string, endOfDay = false): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error("Data inválida");
  d.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return d;
}

function yyyymmddhhmmss(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hostNameOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "Fonte externa"; }
}

async function fetchGoogleHistorical(query: string, start: string, end: string, limit = 25): Promise<ExternalPublication[]> {
  const q = `${query} after:${start} before:${end}`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    return blocks.slice(0, limit).map((block) => {
      const title = cleanText(block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
      const link = decodeXmlValue(block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
      const pubDate = cleanText(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "");
      const source = cleanText(block.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || "") || hostNameOf(link);
      const description = cleanText(block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "");
      return {
        url: link,
        title,
        snippet: description,
        publishedAt: pubDate ? new Date(pubDate).toISOString() : undefined,
        outlet: source,
        outletRegion: "Nacional" as const,
        outletReach: 4,
        source: "rss" as const,
        raw: { source: "google_news_historical" },
      };
    }).filter((p) => p.url && p.title);
  } catch (error) {
    console.warn("[detect-historical-peaks] google rss failed", (error as Error).message);
    return [];
  }
}

async function fetchGdeltHistorical(query: string, start: Date, end: Date, maxRecords = 60): Promise<ExternalPublication[]> {
  const params = new URLSearchParams({
    query: `${query} sourcecountry:BR`,
    mode: "ArtList",
    format: "json",
    maxrecords: String(maxRecords),
    sort: "DateDesc",
    startdatetime: yyyymmddhhmmss(start),
    enddatetime: yyyymmddhhmmss(end),
  });
  try {
    const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params.toString()}`, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) return [];
    const json = await response.json().catch(() => null) as any;
    return (Array.isArray(json?.articles) ? json.articles : []).map((a: any) => ({
      url: String(a?.url || ""),
      title: cleanText(a?.title || "").slice(0, 300),
      snippet: cleanText(a?.seendate ? `Publicado em ${a.seendate}` : a?.title || "").slice(0, 320),
      publishedAt: a?.seendate ? String(a.seendate).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1-$2-$3T$4:$5:$6Z") : undefined,
      outlet: String(a?.domain || hostNameOf(String(a?.url || ""))),
      outletRegion: "Nacional" as const,
      outletReach: 4,
      source: "gdelt" as const,
      raw: a,
    })).filter((p: ExternalPublication) => p.url && p.title);
  } catch (error) {
    console.warn("[detect-historical-peaks] gdelt failed", (error as Error).message);
    return [];
  }
}

function timelineCandidates(points: TimelinePoint[]): TimelinePoint[] {
  if (!points.length) return [];
  const counts = points.map((p) => Number(p.count || 0));
  const avg = counts.reduce((s, n) => s + n, 0) / Math.max(counts.length, 1);
  return points
    .map((p, i) => {
      const prev = counts.slice(Math.max(0, i - 7), i);
      const baseline = prev.length ? prev.reduce((s, n) => s + n, 0) / prev.length : avg;
      const growth = baseline > 0 ? ((p.count - baseline) / baseline) * 100 : 0;
      return { ...p, growth };
    })
    .filter((p: any) => p.count >= 15 && (p.count >= Math.max(25, avg * 2) || p.growth >= 300))
    .sort((a: any, b: any) => (b.count * Math.max(1, b.growth / 100)) - (a.count * Math.max(1, a.growth / 100)))
    .slice(0, 20);
}

serve(async (req) => {
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

    const { candidateId, startDate, endDate, localTimeline = [] } = await req.json();
    if (!candidateId || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "candidateId, startDate e endDate são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const start = parseDate(startDate);
    const end = parseDate(endDate, true);
    const startShort = start.toISOString().slice(0, 10);
    const endShort = end.toISOString().slice(0, 10);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: candidate } = await admin.from("candidates").select("id, full_name, party, user_id").eq("id", candidateId).maybeSingle();
    if (!candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const contextual = buildContextualQueries(candidate.full_name, 6);
    const queryRoots = Array.from(new Set([
      `"${candidate.full_name}"`,
      ...contextual,
      ...EVENT_TERMS.slice(0, 8).map((term) => `"${candidate.full_name}" ${term}`),
    ])).slice(0, 12);

    const tbs = days <= 31 ? "qdr:m" : "qdr:y";
    const [googleSettled, gdeltSettled, firecrawlSettled] = await Promise.all([
      Promise.allSettled(queryRoots.map((q) => fetchGoogleHistorical(q, startShort, endShort, 16))),
      Promise.allSettled(queryRoots.slice(0, 6).map((q) => fetchGdeltHistorical(q, start, end, 40))),
      Promise.allSettled(queryRoots.slice(0, 5).map((q) => firecrawlSearch(`${q} ${start.getFullYear()} ${end.getFullYear()}`, { limit: 8, tbs: tbs as "qdr:m" | "qdr:y" }))),
    ]);

    const pubs = dedupePublications([
      ...googleSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...gdeltSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...firecrawlSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
    ]).filter((p) => {
      const date = p.publishedAt ? new Date(p.publishedAt).getTime() : 0;
      const inWindow = !date || (date >= start.getTime() - 86400000 && date <= end.getTime() + 86400000);
      const text = normalize(`${p.title} ${p.snippet}`);
      const candidateTokens = normalize(candidate.full_name).split(/\s+/).filter((t: string) => t.length >= 4 && !["das", "dos", "de", "da", "do"].includes(t));
      const nameHit = text.includes(normalize(candidate.full_name)) || candidateTokens.filter((t: string) => text.includes(t)).length >= Math.min(2, candidateTokens.length);
      return inWindow && nameHit;
    }).slice(0, 140);

    const localCandidates = timelineCandidates(Array.isArray(localTimeline) ? localTimeline : []);
    if (pubs.length === 0 && localCandidates.length === 0) {
      return new Response(JSON.stringify({ events: [], publications_collected: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const corpus = pubs.slice(0, 110).map((p, i) =>
      `[${i + 1}] (${p.outlet}, ${p.publishedAt?.slice(0, 10) || "?"}, ${p.source}) ${cleanText(p.title).slice(0, 180)} — ${cleanText(p.snippet).slice(0, 220)} | ${p.url}`
    ).join("\n");
    const localSignal = localCandidates.map((p: any) => `${p.date}: ${p.count} menções (${Math.round(p.growth || 0)}%)`).join("\n") || "sem sinal interno relevante";

    const prompt = `Você é um analista político histórico brasileiro. Descubra MÚLTIPLOS acontecimentos políticos reais de ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ""} entre ${startShort} e ${endShort}.

CRITÉRIOS OBRIGATÓRIOS:
- Só crie evento se houver fato político identificável: notícia, vídeo, entrevista, debate, discurso, coletiva, decisão judicial, eleição, CPI, operação policial, votação ou acontecimento nacional.
- Não crie evento baseado apenas em 3, 4, 5 ou 10 menções sem fonte externa.
- O ranking deve priorizar relevância histórica/documental, não volume bruto.
- Explique o que aconteceu, por que aconteceu, quem repercutiu, veículos envolvidos e redes que impulsionaram quando houver sinal interno.
- Se uma fonte não provar um evento, ignore.

SINAIS INTERNOS DE CRESCIMENTO:
${localSignal}

PUBLICAÇÕES EXTERNAS:
${corpus || "sem publicações externas"}

Responda APENAS JSON válido:
{
  "events": [
    {
      "name": "nome factual do acontecimento",
      "type": "eleicao|debate|entrevista|discurso|coletiva|decisao_judicial|cpi|operacao|votacao|agenda|noticia|repercussao_social_evidenciada",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "o que aconteceu e por que importou",
      "motivo": "por que isso é um pico histórico real",
      "keywords": ["termo1", "termo2"],
      "sourceIndices": [1,2],
      "relevance_score": 0,
      "mentions_estimate": 0,
      "variation_pct": 0
    }
  ]
}`;

    let parsed: any = { events: [] };
    try {
      const ai = await callAICerebrasFirst({
        systemMsg: "Você detecta acontecimentos políticos reais a partir de fontes documentadas. Nunca invente picos genéricos. Responda só JSON em pt-BR.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 5000,
        temperature: 0.12,
        tag: "detect-historical-peaks",
      });
      const content = ai.content || "";
      try { parsed = JSON.parse(content); }
      catch { const m = content.match(/\{[\s\S]*\}/); if (m) parsed = JSON.parse(m[0]); }
    } catch (error) {
      console.error("[detect-historical-peaks] AI failed", (error as Error).message);
    }

    const localByDate = new Map((Array.isArray(localTimeline) ? localTimeline : []).map((p: TimelinePoint) => [p.date, p]));
    const events = (Array.isArray(parsed?.events) ? parsed.events : []).map((evt: any) => {
      const sourceIndices = Array.isArray(evt.sourceIndices) ? evt.sourceIndices.map((n: any) => Number(n) - 1).filter((n: number) => n >= 0 && n < pubs.length) : [];
      const evPubs = sourceIndices.map((i: number) => pubs[i]).filter(Boolean);
      const distinctOutlets = new Set(evPubs.map((p) => normalize(p.outlet))).size;
      const day = String(evt.start_date || "").slice(0, 10);
      const local = localByDate.get(day) as any;
      const mentions = Math.max(Number(evt.mentions_estimate || 0), Number(local?.count || 0));
      const score = Math.max(0, Math.min(100, Number(evt.relevance_score || 0)))
        + Math.min(20, distinctOutlets * 4)
        + Math.min(15, evPubs.length * 2)
        + Math.min(10, mentions / 10);
      return {
        name: cleanText(evt.name).slice(0, 180),
        type: cleanText(evt.type || "noticia"),
        keywords: Array.isArray(evt.keywords) ? evt.keywords.map(cleanText).filter(Boolean).slice(0, 10) : [],
        start_date: day || startShort,
        end_date: String(evt.end_date || day || startShort).slice(0, 10),
        mentions_estimate: mentions,
        variation_pct: Number(evt.variation_pct || local?.growth || 0),
        description: cleanText(evt.description).slice(0, 700),
        motivo: cleanText(evt.motivo).slice(0, 300),
        confirmed_event: evPubs.length > 0,
        evidence_level: evPubs.length > 0 ? "evento_documentado" : "volume_relevante",
        relevance_score: Math.round(score),
        publications_count: evPubs.length,
        distinct_outlets: distinctOutlets,
        sources: evPubs.map((p) => ({ name: p.outlet, url: p.url, region: p.outletRegion })),
        source_titles: evPubs.map((p) => p.title).slice(0, 5),
        topNetworks: [],
      };
    }).filter((evt: any) => {
      const eventDate = new Date(`${evt.start_date}T12:00:00Z`).getTime();
      if (eventDate < start.getTime() - 86400000 || eventDate > end.getTime() + 86400000) return false;
      if ((evt.mentions_estimate || 0) <= 10 && !evt.confirmed_event) return false;
      return evt.name && evt.description && (evt.confirmed_event || (evt.mentions_estimate || 0) >= 25);
    }).sort((a: any, b: any) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 30);

    return new Response(JSON.stringify({
      events,
      publications_collected: pubs.length,
      estimated_reach: estimatedReachOf(pubs),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[detect-historical-peaks]", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Erro desconhecido" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});