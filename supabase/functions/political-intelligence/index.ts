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
  return unique.slice(0, 60);
}

const SYSTEM = `Você é um analista político sênior brasileiro. Analise notícias REAIS recentes sobre o político informado e produza um briefing estratégico em JSON ESTRITO. Responda SEMPRE em português do Brasil. Seja factual: use APENAS o que está nas notícias fornecidas. Não invente eventos. Se faltar evidência, declare incerteza nos campos.`;

function buildPrompt(name: string, items: RawItem[]) {
  const corpus = items.map((it, i) => `[${i + 1}] (${it.source} · ${it.published_at.slice(0, 10)}) ${it.title}${it.summary ? " — " + it.summary : ""}`).join("\n");
  return `POLÍTICO: ${name}

NOTÍCIAS COLETADAS (${items.length}):
${corpus || "(nenhuma notícia recente encontrada)"}

Produza JSON ESTRITO com esta forma exata (sem texto antes/depois, sem markdown):
{
  "status": "estável" | "em alta" | "em queda" | "crise" | "neutro",
  "momentum_score": número de -100 a 100,
  "reputation_risk": "baixo" | "moderado" | "alto" | "crítico",
  "election_strength": "fraca" | "moderada" | "forte" | "dominante",
  "dominant_narrative": "frase curta (máx 140 chars) descrevendo a narrativa principal agora",
  "key_events": [
    { "title": "título curto", "date": "AAAA-MM-DD", "impact": "positivo|negativo|neutro", "summary": "1-2 frases", "source": "fonte", "url": "url" }
  ],
  "narrative_shifts": ["mudanças de narrativa observáveis nas últimas semanas"],
  "emerging_risks": ["riscos reputacionais ou jurídicos emergentes"],
  "strategic_analysis": "parágrafo executivo (3-6 frases) em linguagem humana, tipo análise de consultor político, citando o que está acontecendo, por quê, e qual o impacto eleitoral.",
  "confidence": "baixa" | "média" | "alta",
  "evidence_count": número
}

REGRAS:
- "key_events" deve conter de 3 a 8 eventos REAIS extraídos das notícias acima (use os índices). Não invente.
- Se houver menos de 5 notícias, marque confidence="baixa" e seja conservador no momentum.
- "evidence_count" = número de notícias usadas.
- Nunca retorne texto fora do JSON.`;
}

function safeJsonParse(s: string): any | null {
  try { return JSON.parse(s); } catch { /* try strip */ }
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;
  try {
    await tryVerifyJwt(req); // optional auth, just for usage tracking
    const { candidate_name } = await req.json().catch(() => ({}));
    if (!candidate_name || typeof candidate_name !== "string") {
      return jsonResponse({ error: "candidate_name required" }, 400);
    }

    console.log(`[political-intelligence] candidate=${candidate_name}`);
    const items = await fetchAllSources(candidate_name);
    console.log(`[political-intelligence] fetched ${items.length} items`);

    if (items.length === 0) {
      return jsonResponse({
        candidate_name,
        fetched_at: new Date().toISOString(),
        sources_count: 0,
        analysis: {
          status: "neutro",
          momentum_score: 0,
          reputation_risk: "baixo",
          election_strength: "moderada",
          dominant_narrative: "Sem cobertura noticiosa relevante no momento.",
          key_events: [],
          narrative_shifts: [],
          emerging_risks: [],
          strategic_analysis: `Não foram encontradas notícias recentes sobre ${candidate_name} nas fontes monitoradas. Isso pode indicar baixa exposição midiática ou ausência de eventos recentes de relevância política.`,
          confidence: "baixa",
          evidence_count: 0,
        },
        raw_items: [],
      });
    }

    const ai = await callAICerebrasFirst({
      systemMsg: SYSTEM,
      userPrompt: buildPrompt(candidate_name, items),
      jsonMode: true,
      maxTokens: 2200,
      temperature: 0.3,
      tag: "political-intelligence",
    });

    const parsed = safeJsonParse(ai.content);
    if (!parsed) {
      console.error("[political-intelligence] JSON parse failed", ai.content?.slice(0, 200));
      return jsonResponse({ error: "ai_invalid_json", provider: ai.provider }, 502);
    }

    return jsonResponse({
      candidate_name,
      fetched_at: new Date().toISOString(),
      sources_count: items.length,
      provider: ai.provider,
      model: ai.model,
      analysis: parsed,
      raw_items: items.slice(0, 30),
    });
  } catch (e) {
    console.error("[political-intelligence] error", e);
    return jsonResponse({ error: String((e as Error)?.message || e) }, 500);
  }
});
