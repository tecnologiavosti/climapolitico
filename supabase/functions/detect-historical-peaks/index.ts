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
  "agenda", "reunião", "ato de governo", "investigação", "indiciamento", "cassação", "inelegibilidade",
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

function eventYearQueries(candidateName: string, start: Date, end: Date): string[] {
  const years = new Set<number>();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) years.add(y);
  const terms = [
    "eleição", "campanha", "segundo turno", "primeiro turno", "debate", "entrevista",
    "posse", "investigação", "STF", "TSE", "Senado", "CPI", "votação", "discurso",
  ];
  const queries: string[] = [];
  for (const year of years) {
    for (const term of terms) queries.push(`"${candidateName}" ${term} ${year}`);
  }
  return queries;
}

function sourceDateMs(pub: ExternalPublication): number | null {
  if (!pub.publishedAt) return null;
  const t = new Date(pub.publishedAt).getTime();
  return Number.isFinite(t) ? t : null;
}

function isOfficialOrJournalistic(pub: ExternalPublication): boolean {
  const host = hostNameOf(pub.url).toLowerCase();
  const outlet = normalize(pub.outlet || "");
  return /\.(gov|jus|leg)\.br$|gov\.br|tse\.jus\.br|stf\.jus\.br|senado\.leg\.br|camara\.leg\.br|planalto\.gov\.br|youtube\.com|youtu\.be|g1\.globo\.com|folha\.uol\.com\.br|estadao\.com\.br|valor\.globo\.com|poder360\.com\.br|cnnbrasil\.com\.br|uol\.com\.br|metropoles\.com|reuters\.com|bbc\.com|oglobo\.globo\.com|veja\.abril\.com\.br|terra\.com\.br|r7\.com|band\.uol\.com\.br/i.test(host)
    || /agencia brasil|senado|camara|stf|tse|reuters|bbc|folha|estadao|estadao conteudo|valor|g1|cnn|uol|poder360|metropoles|o globo|oglobo|veja|terra|isto[eé]|r7|band|record|jovem pan|congresso em foco|carta ?capital/.test(outlet);
}

function significantTokens(value: string): string[] {
  return normalize(value).match(/[a-z0-9]{4,}/g)?.filter((t) => !["para", "como", "sobre", "entre", "pela", "pelo", "brasil", "politico", "politica", "noticia", "evento"].includes(t)) || [];
}

function supportTermsForEvent(evt: any, candidateName: string): string[] {
  const candidateTokens = new Set(significantTokens(candidateName));
  return Array.from(new Set([
    ...((Array.isArray(evt?.keywords) ? evt.keywords : []) as string[]).flatMap(significantTokens),
    ...significantTokens(`${evt?.name || ""} ${evt?.description || ""} ${evt?.type || ""}`).slice(0, 10),
  ])).filter((term) => !candidateTokens.has(term)).slice(0, 16);
}

function sourceSupportsEvent(pub: ExternalPublication, evt: any, start: Date, end: Date, candidateName: string): boolean {
  if (!isOfficialOrJournalistic(pub)) return false;
  const text = normalize(`${pub.title} ${pub.snippet} ${pub.outlet}`);
  const candidateTokens = normalize(candidateName).split(/\s+/).filter((t) => t.length >= 4 && !["das", "dos", "de", "da", "do"].includes(t));
  const candidateHit = text.includes(normalize(candidateName)) || (candidateTokens.length > 0 && candidateTokens.filter((t) => text.includes(t)).length >= Math.min(2, candidateTokens.length));
  const terms = supportTermsForEvent(evt, candidateName);
  const hasTerm = terms.length > 0 && terms.some((term) => text.includes(term));
  const hasPoliticalEventTerm = EVENT_TERMS.some((term) => text.includes(normalize(term)));
  const date = sourceDateMs(pub);
  const eventStart = new Date(`${String(evt?.start_date || start.toISOString().slice(0, 10)).slice(0, 10)}T00:00:00Z`).getTime();
  const eventEnd = new Date(`${String(evt?.end_date || evt?.start_date || end.toISOString().slice(0, 10)).slice(0, 10)}T23:59:59Z`).getTime();
  const withinEvent = date == null || (date >= eventStart - 21 * 86400000 && date <= eventEnd + 21 * 86400000);
  const withinPeriod = date == null || (date >= start.getTime() - 86400000 && date <= end.getTime() + 86400000);
  return candidateHit && (hasTerm || hasPoliticalEventTerm) && withinEvent && withinPeriod;
}

function matchedSources(evt: any, pubs: ExternalPublication[], start: Date, end: Date, candidateName: string): ExternalPublication[] {
  const indices = Array.isArray(evt?.sourceIndices)
    ? evt.sourceIndices.map((n: any) => Number(n) - 1).filter((n: number) => n >= 0 && n < pubs.length)
    : [];
  const selected = indices.map((i: number) => pubs[i]).filter((p: ExternalPublication) => sourceSupportsEvent(p, evt, start, end, candidateName));
  if (selected.length > 0) return selected;
  return pubs.filter((p) => sourceSupportsEvent(p, evt, start, end, candidateName)).slice(0, 8);
}

function coverageDurationDays(pubs: ExternalPublication[]): number {
  const dates = pubs.map(sourceDateMs).filter((n): n is number => n != null).sort((a, b) => a - b);
  if (dates.length < 2) return pubs.length > 0 ? 1 : 0;
  return Math.max(1, Math.ceil((dates[dates.length - 1] - dates[0]) / 86400000) + 1);
}

function politicalImpactWeight(type: string): number {
  const t = normalize(type);
  if (/eleicao|decisao|judicial|operacao|cpi|votacao|posse/.test(t)) return 24;
  if (/debate|entrevista|discurso|coletiva|agenda/.test(t)) return 16;
  return 10;
}

function relevanceFromEvidence(evt: any, pubs: ExternalPublication[], mentions: number): number {
  const distinctOutlets = new Set(pubs.map((p) => normalize(p.outlet))).size;
  const reach = pubs.reduce((sum, p) => sum + (p.outletReach || 3), 0);
  const officialBonus = pubs.some((p) => /\.(gov|jus|leg)\.br|gov\.br|tse\.jus\.br|stf\.jus\.br|senado\.leg\.br|camara\.leg\.br/i.test(hostNameOf(p.url))) ? 12 : 0;
  const score = Math.min(35, distinctOutlets * 9)
    + Math.min(18, pubs.length * 3)
    + Math.min(18, reach * 1.7)
    + Math.min(10, coverageDurationDays(pubs) * 2)
    + politicalImpactWeight(String(evt?.type || evt?.name || ""))
    + officialBonus
    + Math.min(5, mentions / 25);
  return Math.max(30, Math.min(100, Math.round(score)));
}

function fallbackEventsFromSources(pubs: ExternalPublication[], start: Date, end: Date): any[] {
  const buckets = new Map<string, ExternalPublication[]>();
  for (const pub of pubs) {
    if (!isOfficialOrJournalistic(pub)) continue;
    const date = pub.publishedAt ? new Date(pub.publishedAt).toISOString().slice(0, 10) : start.toISOString().slice(0, 10);
    const tokens = significantTokens(pub.title).slice(0, 5).join(" ");
    const key = `${date}|${tokens}`;
    buckets.set(key, [...(buckets.get(key) || []), pub]);
  }
  return [...buckets.entries()].map(([key, sources]) => {
    const [date] = key.split("|");
    const main = sources[0];
    const title = cleanText(main.title).replace(/\s+-\s+[^-]{2,80}$/g, "");
    const terms = EVENT_TERMS.filter((term) => normalize(`${main.title} ${main.snippet}`).includes(normalize(term))).slice(0, 5);
    return {
      name: title || `Acontecimento político documentado em ${date}`,
      type: terms[0] || "noticia",
      start_date: date,
      end_date: date,
      description: cleanText(main.snippet || main.title).slice(0, 500),
      motivo: `Evento identificado a partir de cobertura externa documentada por ${new Set(sources.map((s) => s.outlet)).size} veículo(s).`,
      keywords: terms.length ? terms : significantTokens(main.title).slice(0, 6),
      sourceIndices: sources.map((s) => pubs.findIndex((p) => p.url === s.url) + 1).filter((n) => n > 0),
      relevance_score: relevanceFromEvidence({ type: terms[0], name: title }, sources, 0),
      mentions_estimate: 0,
      variation_pct: 0,
    };
  }).filter((evt) => {
    const t = new Date(`${evt.start_date}T12:00:00Z`).getTime();
    return t >= start.getTime() - 86400000 && t <= end.getTime() + 86400000;
  }).sort((a, b) => Number(b.relevance_score || 0) - Number(a.relevance_score || 0)).slice(0, 24);
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
    query,
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

    const contextual = buildContextualQueries(candidate.full_name, 8);
    const queryRoots = Array.from(new Set([
      `"${candidate.full_name}"`,
      ...contextual,
      ...eventYearQueries(candidate.full_name, start, end),
      ...EVENT_TERMS.map((term) => `"${candidate.full_name}" ${term}`),
    ])).slice(0, days > 370 ? 34 : 22);

    const tbs = days <= 31 ? "qdr:m" : "qdr:y";
    const [googleSettled, gdeltSettled, firecrawlSettled] = await Promise.all([
      Promise.allSettled(queryRoots.map((q) => fetchGoogleHistorical(q, startShort, endShort, 18))),
      Promise.allSettled(queryRoots.slice(0, 14).map((q) => fetchGdeltHistorical(q, start, end, 45))),
      Promise.allSettled(queryRoots.slice(0, 10).map((q) => firecrawlSearch(`${q} ${start.getFullYear()} ${end.getFullYear()}`, { limit: 8, tbs: tbs as "qdr:m" | "qdr:y" }))),
    ]);

    const pubs = dedupePublications([
      ...googleSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...gdeltSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
      ...firecrawlSettled.flatMap((r) => r.status === "fulfilled" ? r.value : []),
    ]).filter((p) => {
      const date = p.publishedAt ? new Date(p.publishedAt).getTime() : 0;
      const inWindow = !!date && (date >= start.getTime() - 86400000 && date <= end.getTime() + 86400000);
      const text = normalize(`${p.title} ${p.snippet}`);
      const candidateTokens = normalize(candidate.full_name).split(/\s+/).filter((t: string) => t.length >= 4 && !["das", "dos", "de", "da", "do"].includes(t));
      const nameHit = text.includes(normalize(candidate.full_name)) || candidateTokens.filter((t: string) => text.includes(t)).length >= Math.min(2, candidateTokens.length);
      const eventHit = EVENT_TERMS.some((term) => text.includes(normalize(term)));
      return inWindow && nameHit && eventHit && isOfficialOrJournalistic(p);
    }).slice(0, 220);

    const localCandidates = timelineCandidates(Array.isArray(localTimeline) ? localTimeline : []);
    if (pubs.length === 0) {
      return new Response(JSON.stringify({ events: [], publications_collected: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const corpus = pubs.slice(0, 110).map((p, i) =>
      `[${i + 1}] (${p.outlet}, ${p.publishedAt?.slice(0, 10) || "?"}, ${p.source}) ${cleanText(p.title).slice(0, 180)} — ${cleanText(p.snippet).slice(0, 220)} | ${p.url}`
    ).join("\n");
    const localSignal = localCandidates.map((p: any) => `${p.date}: ${p.count} menções (${Math.round(p.growth || 0)}%)`).join("\n") || "sem sinal interno relevante";

    const prompt = `Você é um analista político histórico brasileiro. Descubra MÚLTIPLOS acontecimentos políticos reais de ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ""} entre ${startShort} e ${endShort}.

CRITÉRIOS OBRIGATÓRIOS:
- A fonte primária é EXTERNA: notícias, registros oficiais, entrevistas, debates, discursos, decisões, votações, CPIs, atos de governo ou redes oficiais.
- Primeiro identifique acontecimentos reais documentados; só depois use sinais internos como correlação secundária.
- É PROIBIDO criar evento com 0 fontes, 0 notícias, 0 evidências ou 0 registros externos.
- Só crie evento se houver fato político identificável: notícia, vídeo, entrevista, debate, discurso, coletiva, decisão judicial, eleição, CPI, operação policial, votação ou acontecimento nacional.
- Não crie evento baseado apenas em 3, 4, 5 ou 10 menções sem fonte externa.
- O ranking deve priorizar veículos distintos, repercussão nacional, duração da cobertura, impacto político e engajamento público; nunca volume bruto interno.
- Explique o que aconteceu, por que aconteceu, quem repercutiu, veículos envolvidos, impacto político e impacto eleitoral.
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
      "type": "eleicao|debate|entrevista|discurso|coletiva|decisao_judicial|cpi|operacao|votacao|agenda|noticia",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "o que aconteceu (3-5 frases factuais)",
      "motivo": "por que isso é historicamente relevante",
      "what_happened": "narrativa detalhada do acontecimento",
      "why_happened": "contexto e motivações",
      "participants": ["pessoa/instituição 1", "pessoa/instituição 2"],
      "political_impact": "impacto institucional e político",
      "electoral_impact": "impacto eleitoral (se houver)",
      "aftermath": "desdobramentos posteriores documentados",
      "keywords": ["termo1", "termo2"],
      "sourceIndices": [1,2],
      "relevance_score": 0
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

    const candidateEvents = Array.isArray(parsed?.events) && parsed.events.length > 0 ? parsed.events : fallbackEventsFromSources(pubs, start, end);
    const localByDate = new Map((Array.isArray(localTimeline) ? localTimeline : []).map((p: TimelinePoint) => [p.date, p]));
    const events = candidateEvents.map((evt: any) => {
      const evPubs = matchedSources(evt, pubs, start, end, candidate.full_name);
      const distinctOutlets = new Set(evPubs.map((p) => normalize(p.outlet))).size;
      const day = String(evt.start_date || "").slice(0, 10);
      const local = localByDate.get(day) as any;
      const mentions = Math.max(Number(evt.mentions_estimate || 0), Number(local?.count || 0));
      const score = relevanceFromEvidence(evt, evPubs, mentions);
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
        confirmed_event: true,
        evidence_level: "evento_documentado",
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
      return evt.name && evt.description && (evt.publications_count || 0) >= 1 && (evt.sources?.length || 0) >= 1;
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