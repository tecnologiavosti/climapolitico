// Political Intelligence — AI-first analysis from external sources only.
// Fetches Google News + political RSS, hands raw items to AI, returns a
// structured strategic briefing. Does NOT consult social_interactions.
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { tryVerifyJwt } from "../_shared/auth.ts";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

interface RawItem {
  source: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
}

const RSS_FEEDS = (q: string) => [
  // Google News (BR-PT)
  { src: "Google News", url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=pt-BR&gl=BR&ceid=BR:pt-419` },
  // Portais políticos
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

const stripHtml = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function parseRss(xml: string, sourceLabel: string): RawItem[] {
  const items: RawItem[] = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);
  for (const block of blocks) {
    const end = block.indexOf("</item>");
    const body = end >= 0 ? block.slice(0, end) : block;
    const title = stripHtml((body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]) || "");
    const link = stripHtml((body.match(/<link>([\s\S]*?)<\/link>/i)?.[1]) || "");
    const desc = stripHtml((body.match(/<description>([\s\S]*?)<\/description>/i)?.[1]) || "");
    const pub = stripHtml((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]) || "");
    if (!title) continue;
    items.push({
      source: sourceLabel,
      title: title.slice(0, 300),
      summary: desc.slice(0, 500),
      url: link,
      published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
    });
  }
  return items;
}

async function fetchAllSources(candidateName: string): Promise<RawItem[]> {
  const feeds = RSS_FEEDS(`"${candidateName}"`);
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const r = await fetch(f.url, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 ClimaPolitico/1.0" } });
      if (!r.ok) return [];
      const xml = await r.text();
      return parseRss(xml, f.src);
    })
  );
  const all: RawItem[] = [];
  for (const r of results) if (r.status === "fulfilled") all.push(...r.value);
  // dedupe by title
  const seen = new Set<string>();
  const unique = all.filter((i) => {
    const k = i.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  // sort newest first, cap
  unique.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  return unique.slice(0, 100);
}

// Filter by age. Tries 24h first; falls back to 48h if too few hits.
function filterRealtime(items: RawItem[]): { items: RawItem[]; windowHours: number } {
  const now = Date.now();
  const ageHours = (it: RawItem) => (now - new Date(it.published_at).getTime()) / 3600000;
  const last24 = items.filter((i) => ageHours(i) <= 24 && ageHours(i) >= 0);
  if (last24.length >= 5) return { items: last24, windowHours: 24 };
  const last48 = items.filter((i) => ageHours(i) <= 48 && ageHours(i) >= 0);
  return { items: last48, windowHours: 48 };
}

// Public-movement intensity (0-100): volume 6h + 24h growth + freshness weighting.
function computeIntensity(items: RawItem[]): { score: number; label: string; volume6h: number; volume24h: number; growthPct: number } {
  const now = Date.now();
  const ageHours = (it: RawItem) => (now - new Date(it.published_at).getTime()) / 3600000;
  const v6 = items.filter((i) => ageHours(i) <= 6).length;
  const v24 = items.filter((i) => ageHours(i) <= 24).length;
  const v6Prev = items.filter((i) => ageHours(i) > 6 && ageHours(i) <= 12).length;
  // Volume component: 6h count, log-scaled, anchored so 30 itens em 6h ≈ 100.
  const volScore = Math.min(100, Math.log2(v6 + 1) * 22);
  // Growth component: comparison to previous 6h window.
  const growthPct = v6Prev === 0 ? (v6 > 0 ? 100 : 0) : ((v6 - v6Prev) / v6Prev) * 100;
  const growthScore = Math.max(0, Math.min(100, 50 + growthPct / 2));
  // Source diversity (proxy de engajamento público).
  const sources = new Set(items.filter((i) => ageHours(i) <= 24).map((i) => i.source)).size;
  const diversityScore = Math.min(100, sources * 12);
  const score = Math.round(volScore * 0.5 + growthScore * 0.3 + diversityScore * 0.2);
  let label = "Muito baixa";
  if (score > 80) label = "Explosiva";
  else if (score > 60) label = "Alta";
  else if (score > 40) label = "Moderada";
  else if (score > 20) label = "Baixa";
  return { score, label, volume6h: v6, volume24h: v24, growthPct: Math.round(growthPct) };
}

const SYSTEM = `Você é um analista político sênior brasileiro de monitoramento em TEMPO REAL.

REGRAS ABSOLUTAS:
- Analise SOMENTE as fontes fornecidas no prompt.
- NUNCA use conhecimento pré-treinado, contexto histórico ou eventos passados não citados nas fontes.
- NUNCA invente eventos, datas, citações ou narrativas.
- NUNCA mencione eventos fora da janela de tempo informada (24h ou 48h).
- Se as fontes forem insuficientes/irrelevantes, retorne APENAS a string: INSUFFICIENT_REALTIME_DATA (sem JSON, sem aspas).
- Responda em português do Brasil.`;

function buildPrompt(name: string, items: RawItem[], windowHours: number) {
  const corpus = items
    .map((it, i) => `[${i + 1}] (${it.source} · ${it.published_at}) ${it.title}${it.summary ? " — " + it.summary : ""}`)
    .join("\n");
  return `POLÍTICO: ${name}
AGORA: ${new Date().toISOString()}
JANELA: últimas ${windowHours} horas.

FONTES COLETADAS NESSA JANELA (${items.length}):
${corpus}

INSTRUÇÕES:
- Use APENAS as ${items.length} fontes acima. Toda data em key_events DEVE estar dentro das últimas ${windowHours}h.
- Se as fontes não permitirem análise estratégica confiável (irrelevantes ao político ou em volume insuficiente), responda APENAS: INSUFFICIENT_REALTIME_DATA
- Caso contrário, produza JSON ESTRITO (sem markdown, sem texto fora):

{
  "status": "estável" | "em alta" | "em queda" | "crise" | "neutro",
  "reputation_risk": "baixo" | "moderado" | "alto" | "crítico",
  "election_strength": "fraca" | "moderada" | "forte" | "dominante",
  "dominant_narrative": "frase curta (máx 140 chars), baseada APENAS nas fontes",
  "key_events": [
    { "title": "título curto", "date": "AAAA-MM-DD", "impact": "positivo|negativo|neutro", "summary": "1-2 frases", "source": "fonte", "url": "url" }
  ],
  "narrative_shifts": ["mudanças observadas SOMENTE nas fontes acima"],
  "emerging_risks": ["riscos extraídos APENAS das fontes acima"],
  "strategic_analysis": "parágrafo (3-6 frases) baseado SOMENTE nas fontes",
  "confidence": "baixa" | "média" | "alta",
  "evidence_count": ${items.length}
}`;
}

function safeJsonParse(s: string): any | null {
  const t = (s || "").trim();
  if (/INSUFFICIENT_REALTIME_DATA/i.test(t)) return { __insufficient: true };
  try { return JSON.parse(t); } catch { /* try strip */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  try {
    await tryVerifyJwt(req); // optional, usage tracking only
    const { candidate_name } = await req.json().catch(() => ({}));
    if (!candidate_name || typeof candidate_name !== "string") {
      return jsonResponse({ error: "candidate_name required" }, 400);
    }

    console.log(`[political-intelligence] candidate=${candidate_name}`);
    const allItems = await fetchAllSources(candidate_name);
    const { items, windowHours } = filterRealtime(allItems);
    const intensity = computeIntensity(allItems);
    console.log(`[political-intelligence] fetched=${allItems.length} recent(${windowHours}h)=${items.length} intensity=${intensity.score}`);

    // < 5 fontes recentes → curto-circuito: nada vai pra IA.
    if (items.length < 5) {
      return jsonResponse({
        candidate_name,
        fetched_at: new Date().toISOString(),
        window_hours: windowHours,
        sources_count: items.length,
        intensity,
        insufficient: true,
        message: "Dados insuficientes para análise em tempo real.",
        raw_items: items,
      });
    }

    const ai = await callAICerebrasFirst({
      systemMsg: SYSTEM,
      userPrompt: buildPrompt(candidate_name, items, windowHours),
      jsonMode: true,
      maxTokens: 2200,
      temperature: 0.2,
      tag: "political-intelligence",
    });

    const parsed = safeJsonParse(ai.content);

    if (!parsed) {
      console.error("[political-intelligence] JSON parse failed", ai.content?.slice(0, 200));
      return jsonResponse({ error: "ai_invalid_json", provider: ai.provider }, 502);
    }

    if (parsed.__insufficient) {
      return jsonResponse({
        candidate_name,
        fetched_at: new Date().toISOString(),
        window_hours: windowHours,
        sources_count: items.length,
        intensity,
        insufficient: true,
        message: "Não há evidências suficientes para análise estratégica confiável.",
        raw_items: items,
      });
    }

    // Saneamento de datas: descarta key_events fora da janela.
    if (Array.isArray(parsed.key_events)) {
      const now = Date.now();
      const cutoffMs = windowHours * 3600000;
      parsed.key_events = parsed.key_events.filter((ev: any) => {
        if (!ev?.date) return false;
        const t = new Date(ev.date).getTime();
        if (Number.isNaN(t)) return false;
        return now - t <= cutoffMs && t <= now + 86400000;
      });
    }

    return jsonResponse({
      candidate_name,
      fetched_at: new Date().toISOString(),
      window_hours: windowHours,
      sources_count: items.length,
      provider: ai.provider,
      model: ai.model,
      intensity,
      analysis: parsed,
      raw_items: items.slice(0, 30),
    });
  } catch (e) {
    console.error("[political-intelligence] error", e);
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
