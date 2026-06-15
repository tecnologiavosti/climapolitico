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

const stripHtml = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

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
    const title = stripHtml((body.match(/<title>([\s\S]*?)<\/title>/i)?.[1]) || "");
    const link = stripHtml((body.match(/<link>([\s\S]*?)<\/link>/i)?.[1]) || "");
    const desc = stripHtml((body.match(/<description>([\s\S]*?)<\/description>/i)?.[1]) || "");
    const pub = stripHtml((body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]) || "");
    const iso = parsePubDate(pub);
    if (!title || !iso) continue; // descarta sem título OU sem timestamp confiável
    items.push({
      source: sourceLabel,
      title: title.slice(0, 300),
      summary: desc.slice(0, 500),
      url: link,
      published_at: iso,
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
  const t = (s || "").trim();
  try { return JSON.parse(t); } catch { /* try strip */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
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

    const ai = await callAICerebrasFirst({
      systemMsg: SYSTEM,
      userPrompt: buildPrompt(candidate_name, realtimeItems, confidence),
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
      provider: ai.provider,
      model: ai.model,
      intensity,
      analysis: parsed,
      raw_items: realtimeItems.slice(0, 30),
    });
  } catch (e) {
    console.error("[political-intelligence] error", e);
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
