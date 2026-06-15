// Political Intelligence — AI-first realtime analysis (últimas 24h).
// Coleta apenas fontes externas recentes (<=24h) e entrega à IA, que deve
// analisar SOMENTE essas fontes — sem conhecimento pré-treinado, sem inventar.
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { tryVerifyJwt } from "../_shared/auth.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

interface RawItem {
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string; // ISO
}

const RSS_FEEDS = (q: string) => [
  { src: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "Poder360", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:poder360.com.br")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "Congresso em Foco", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:congressoemfoco.uol.com.br")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "Metrópoles", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:metropoles.com")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "G1 Política", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:g1.globo.com/politica")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "STF", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " STF supremo")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "TSE", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " TSE eleições")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "Congresso", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " (Senado OR Câmara OR Congresso)")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "PF", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " (\"Polícia Federal\" OR investigação OR operação)")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  { src: "YouTube", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q + " site:youtube.com")}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
];

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", middot: "·",
};

function decodeEntities(input: string): string {
  return String(input || "").replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (_m, raw: string) => {
    if (raw[0] === "#") {
      const isHex = raw[1]?.toLowerCase() === "x";
      const code = parseInt(raw.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return ""; }
      }
      return "";
    }
    return NAMED_ENTITIES[raw.toLowerCase()] ?? "";
  });
}

function cleanText(value: unknown): string {
  let s = decodeEntities(String(value || ""));
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = s.replace(/<\s*a\b[^>]*>/gi, " ").replace(/<\s*\/\s*a\s*>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/\b(?:href|target|rel|src|class|style)\s*=\s*"[^"]*"/gi, " ");
  s = s.replace(/\b(?:href|target|rel|src|class|style)\s*=\s*'[^']*'/gi, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

function cleanHtml(html: string): string {
  let s = decodeEntities(html || "");
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");
  s = s.replace(/<(nav|footer|header|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]+(?:cookie|banner|advert|publicidade|tracking|analytics|share|social)[^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, " ");
  s = s.replace(/<!--([\s\S]*?)-->/g, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  return s.replace(/\s+/g, " ").trim();
}

function buildFallbackSummary(title: string, candidateName?: string): string {
  const cleanTitle = cleanText(title) || "movimentação política recente";
  const subject = cleanText(candidateName || "o candidato monitorado") || "o candidato monitorado";
  return `Evento detectado envolvendo ${subject}: ${cleanTitle}. A cobertura recente indica movimentação política nas últimas 24h e pode influenciar a leitura pública sobre a candidatura.`;
}

function isBrokenText(s: string): boolean {
  return !s || s.length < 30 || /href\s*=|<\s*a\b|target\s*=|rel\s*=|rss\/articles|news\.google\.com|resumo indisponível|ia não encontrou|content unavailable|null summary/i.test(s);
}

// Parser robusto — só retorna ISO se data realmente válida (não inventa "agora").
function parsePubDate(raw: string): string | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function parseRss(xml: string, sourceLabel: string): RawItem[] {
  const items: RawItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const end = block.indexOf("</item>");
    const body = end >= 0 ? block.slice(0, end) : block;
    const title = cleanText((body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]) || "");
    const link = cleanText((body.match(/<link>([\s\S]*?)<\/link>/i)?.[1]) || "");
    const desc = cleanText((body.match(/<description>([\s\S]*?)<\/description>/i)?.[1]) || "");
    const pub = cleanText((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]) || "");
    const source = cleanText((body.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1]) || sourceLabel);
    const iso = parsePubDate(pub);
    if (!title || !iso) continue; // descarta sem título OU sem timestamp confiável
    items.push({
      source: source || sourceLabel,
      title: title.slice(0, 300),
      summary: desc.slice(0, 500),
      url: link,
      published_at: iso,
    });
  }
  return items;
}

function isGoogleNewsUrl(url: string): boolean {
  return /news\.google\.com\/(rss\/)?articles/i.test(url || "");
}

async function resolveNewsUrl(url: string): Promise<string> {
  if (!url) return "";
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
      headers: FETCH_HEADERS,
    });
    return response.url || url;
  } catch (e) {
    console.warn(`[political-intelligence] URL resolve failed ${url}: ${(e as Error).message}`);
    return url;
  }
}

function extractMeta(html: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, "i");
    const value = html.match(re1)?.[1] || html.match(re2)?.[1];
    if (value) return cleanText(value);
  }
  return "";
}

function isYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url || "");
}

async function extractYoutubeContent(url: string, item: RawItem): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: FETCH_HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const title = extractMeta(html, ["og:title", "twitter:title"]) || item.title;
    const description = extractMeta(html, ["description", "og:description", "twitter:description"]);
    const transcript = html.match(/"transcript"\s*:\s*"([\s\S]{80,3000}?)"/)?.[1] || "";
    return cleanText([transcript, description, title].filter(Boolean).join(". "));
  } catch (e) {
    console.warn(`[political-intelligence] YouTube extraction failed ${url}: ${(e as Error).message}`);
    return cleanText(`${item.summary || ""} ${item.title}`);
  }
}

async function extractReadableContent(url: string): Promise<string> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: FETCH_HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text();
    const meta = extractMeta(html, ["description", "og:description", "twitter:description"]);
    const text = cleanHtml(html);
    return cleanText([meta, text].filter(Boolean).join(". ")).slice(0, 3500);
  } catch (e) {
    console.warn(`[political-intelligence] content extraction failed ${url}: ${(e as Error).message}`);
    return "";
  }
}

function compactContentSummary(content: string, title: string, candidateName: string): string {
  const clean = cleanText(content);
  if (isBrokenText(clean)) return buildFallbackSummary(title, candidateName);
  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((s) => cleanText(s))
    .filter((s) => s.length >= 45 && !/cookies|assine|newsletter|publicidade|javascript|google news/i.test(s));
  const selected = sentences.slice(0, 3).join(" ");
  return cleanText(selected || clean.slice(0, 520)).slice(0, 700) || buildFallbackSummary(title, candidateName);
}

async function enrichRealtimeItems(items: RawItem[], candidateName: string): Promise<RawItem[]> {
  const top = items.slice(0, 35);
  const enriched = await Promise.all(top.map(async (item) => {
    const initialUrl = item.url || "";
    const finalUrl = isGoogleNewsUrl(initialUrl) ? await resolveNewsUrl(initialUrl) : initialUrl;
    const sourceContent = isYoutubeUrl(finalUrl) || /youtube/i.test(item.source)
      ? await extractYoutubeContent(finalUrl || initialUrl, item)
      : await extractReadableContent(finalUrl || initialUrl);
    const summary = compactContentSummary(sourceContent || item.summary, item.title, candidateName);
    return {
      ...item,
      url: finalUrl || initialUrl,
      title: cleanText(item.title).slice(0, 300),
      summary,
      source: cleanText(item.source) || "Fonte externa",
    };
  }));
  return enriched.filter((item) => item.title && item.summary).concat(items.slice(35));
}

async function fetchAllSources(candidateName: string): Promise<RawItem[]> {
  const feeds = RSS_FEEDS(`"${candidateName}"`);
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const r = await fetch(f.url, { signal: AbortSignal.timeout(8000), headers: FETCH_HEADERS });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRss(xml, f.src);
    })
  );
  const all: RawItem[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  const seen = new Set<string>();
  const unique = all.filter((i) => {
    const k = i.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  return unique.slice(0, 150);
}

// Janela ESTRITA: somente últimas 24h. Sem fallback.
function filterRealtime(items: RawItem[]): RawItem[] {
  const now = Date.now();
  return items.filter((i) => {
    const t = new Date(i.published_at).getTime();
    if (Number.isNaN(t)) return false;
    const ageHours = (now - t) / 3600000;
    return ageHours >= 0 && ageHours <= 24;
  });
}

// Intensidade 0-100 = volume_1h*0.4 + crescimento_6h*0.35 + diversidade*0.25.
function computeIntensity(items: RawItem[]): { score: number; label: string; volume1h: number; volume6h: number; volume24h: number; growthPct: number } {
  const now = Date.now();
  const ageHours = (it: RawItem) => (now - new Date(it.published_at).getTime()) / 3600000;
  const v1 = items.filter((i) => ageHours(i) <= 1).length;
  const v6 = items.filter((i) => ageHours(i) <= 6).length;
  const v24 = items.filter((i) => ageHours(i) <= 24).length;
  const v6Prev = items.filter((i) => ageHours(i) > 6 && ageHours(i) <= 12).length;

  // 1h volume — 10 itens/h ~= 100
  const volScore = Math.min(100, Math.log2(v1 + 1) * 30);
  // 6h growth vs prev 6h
  const growthPct = v6Prev === 0 ? (v6 > 0 ? 100 : 0) : ((v6 - v6Prev) / v6Prev) * 100;
  const growthScore = Math.max(0, Math.min(100, 50 + growthPct / 2));
  // Engajamento proxy = diversidade de fontes em 24h
  const sources = new Set(items.map((i) => i.source)).size;
  const engagementScore = Math.min(100, sources * 14);

  const score = Math.round(volScore * 0.4 + growthScore * 0.35 + engagementScore * 0.25);
  let label = "Muito baixa";
  if (score >= 81) label = "Explosiva";
  else if (score >= 61) label = "Alta";
  else if (score >= 41) label = "Moderada";
  else if (score >= 21) label = "Baixa";
  return { score, label, volume1h: v1, volume6h: v6, volume24h: v24, growthPct: Math.round(growthPct) };
}

function confidenceFromCount(n: number): "baixa" | "média" | "alta" {
  if (n >= 16) return "alta";
  if (n >= 6) return "média";
  return "baixa";
}

const SYSTEM = `Você é um analista político sênior brasileiro de monitoramento em TEMPO REAL.

REGRAS ABSOLUTAS:
- Analise SOMENTE as fontes JSON fornecidas no prompt.
- NUNCA use conhecimento pré-treinado, contexto histórico ou eventos passados não citados nas fontes.
- NUNCA invente fatos, datas, citações ou narrativas.
- NUNCA mencione eventos fora das últimas 24 horas.
- Ignore qualquer contexto político histórico que não esteja nas fontes.
- Mesmo com poucas fontes, produza análise proporcional. Reduza a confiança, mas NÃO invente.
- Responda em português do Brasil, em JSON estrito.`;

function buildPrompt(name: string, items: RawItem[], confidence: string) {
  const corpus = items.length === 0
    ? "(nenhuma fonte na janela)"
    : items
        .map((it, i) => `[${i + 1}] (${it.source} · ${it.published_at}) ${it.title}${it.summary ? " — " + it.summary : ""}`)
        .join("\n");
  return `POLÍTICO: ${name}
AGORA: ${new Date().toISOString()}
JANELA: últimas 24 horas (estrito).
CONFIANÇA SUGERIDA: ${confidence} (baseada no volume de fontes).

FONTES COLETADAS (${items.length}):
${corpus}

INSTRUÇÕES:
- Use APENAS as ${items.length} fontes acima. Toda data em key_events DEVE estar dentro das últimas 24h.
- Produza JSON ESTRITO (sem markdown, sem texto fora):

{
  "status": "estável" | "em alta" | "em queda" | "crise" | "neutro",
  "reputation_risk": "baixo" | "moderado" | "alto" | "crítico",
  "election_strength": "fraca" | "moderada" | "forte" | "dominante",
  "dominant_narrative": "frase curta (máx 140 chars), baseada APENAS nas fontes das últimas 24h",
  "key_events": [
    { "title": "título curto", "date": "AAAA-MM-DD", "impact": "positivo|negativo|neutro", "summary": "1-2 frases", "source": "fonte", "url": "url" }
  ],
  "narrative_shifts": ["mudanças observadas SOMENTE nas fontes acima"],
  "emerging_risks": ["riscos extraídos APENAS das fontes acima"],
  "strategic_analysis": "parágrafo (3-6 frases) baseado SOMENTE nas fontes",
  "confidence": "${confidence}",
  "evidence_count": ${items.length}
}`;
}

function safeJsonParse(s: string): any | null {
  let t = (s || "").trim();
  if (!t) return null;
  // strip markdown fences
  t = t.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(t); } catch { /* fallthrough */ }
  // find outermost JSON object
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let body = t.substring(start, end + 1);
  try { return JSON.parse(body); } catch { /* try cleanup */ }
  body = body
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, " ");
  try { return JSON.parse(body); } catch { return null; }
}

function fallbackAnalysis(items: RawItem[], confidence: string) {
  const top = items.slice(0, 8);
  const narrative = top[0]?.title?.slice(0, 140) || "Sem narrativa dominante clara nas últimas 24h.";
  const key_events = top.slice(0, 6).map((it) => ({
    title: it.title.slice(0, 120),
    date: it.published_at.slice(0, 10),
    impact: "neutro",
    summary: it.summary?.slice(0, 200) || it.title.slice(0, 200),
    source: it.source,
    url: it.url,
  }));
  return {
    status: "neutro",
    reputation_risk: "moderado",
    election_strength: "moderada",
    dominant_narrative: narrative,
    key_events,
    narrative_shifts: [],
    emerging_risks: [],
    strategic_analysis: items.length
      ? `Análise automática baseada em ${items.length} fontes coletadas nas últimas 24h. Modelo de IA indisponível neste ciclo; mostrando síntese direta das manchetes recentes.`
      : "Sem fontes coletadas nas últimas 24h.",
    confidence,
    evidence_count: items.length,
  };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  try {
    await tryVerifyJwt(req);
    const { candidate_name } = await req.json().catch(() => ({}));
    if (!candidate_name || typeof candidate_name !== "string") {
      return jsonResponse({ error: "candidate_name required" }, 400);
    }

    console.log(`[political-intelligence] candidate=${candidate_name}`);
    const allItems = await fetchAllSources(candidate_name);
    const realtimeItems = filterRealtime(allItems);
    const oldest = realtimeItems.length
      ? realtimeItems.reduce((o, i) => (new Date(i.published_at) < new Date(o.published_at) ? i : o)).published_at
      : null;

    console.log("TOTAL SOURCES", allItems.length);
    console.log("REALTIME SOURCES", realtimeItems.length);
    console.log("OLDEST SOURCE", oldest);

    const intensity = computeIntensity(realtimeItems);
    const confidence = confidenceFromCount(realtimeItems.length);

    let parsed: any = null;
    let provider = "fallback";
    let model = "";
    try {
      const ai = await callAICerebrasFirst({
        systemMsg: SYSTEM,
        userPrompt: buildPrompt(candidate_name, realtimeItems, confidence),
        jsonMode: true,
        maxTokens: 2200,
        temperature: 0.2,
        tag: "political-intelligence",
      });
      provider = ai.provider;
      model = ai.model;
      parsed = safeJsonParse(ai.content);
      if (!parsed) {
        console.error("[political-intelligence] JSON parse failed", ai.content?.slice(0, 300));
      }
    } catch (aiErr) {
      console.error("[political-intelligence] AI call failed", aiErr);
    }

    if (!parsed) {
      parsed = fallbackAnalysis(realtimeItems, confidence);
    }

    // Sanity: descarta key_events fora das últimas 24h.
    if (Array.isArray(parsed.key_events)) {
      const now = Date.now();
      const cutoffMs = 24 * 3600000;
      parsed.key_events = parsed.key_events.filter((ev: any) => {
        if (!ev?.date) return false;
        const t = new Date(ev.date).getTime();
        if (Number.isNaN(t)) return false;
        return now - t <= cutoffMs && t <= now + 86400000;
      });
    }

    // Garante confiança sincronizada com o volume real.
    parsed.confidence = confidence;
    parsed.evidence_count = realtimeItems.length;

    return jsonResponse({
      candidate_name,
      fetched_at: new Date().toISOString(),
      window_hours: 24,
      sources_count: realtimeItems.length,
      provider,
      model,
      intensity,
      analysis: parsed,
      raw_items: realtimeItems.slice(0, 30),
    });
  } catch (e) {
    console.error("[political-intelligence] error", e);
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
