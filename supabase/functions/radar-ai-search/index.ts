// Edge Function: radar-ai-search
// Híbrido: RSS em tempo real + IA (agrupa, deduplica, classifica). Sem pipeline, sem cron.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const CEREBRAS_URL = "https://api.cerebras.ai/v1/chat/completions";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const CEREBRAS_MODELS = ["gpt-oss-120b", "zai-glm-4.7"];
const GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-2.0-flash-lite"];

interface ReqBody {
  candidate_id?: string | null;
  candidate_name: string;
  start_date: string;
  end_date: string;
  categories?: string[];
  force_refresh?: boolean;
}

interface RawItem {
  title: string;
  url: string;
  source: string;
  type: "institutional" | "news" | "international" | "aggregator";
  pub_date?: string;
  snippet?: string;
}

// ===== 50+ FONTES EXTERNAS =====
const FEEDS: Array<{ name: string; url: string; type: RawItem["type"] }> = [
  // Institucionais
  { name: "Agência Senado", url: "https://www12.senado.leg.br/noticias/ultimas/feed", type: "institutional" },
  { name: "Câmara Notícias", url: "https://www.camara.leg.br/noticias/rss/ultimas", type: "institutional" },
  { name: "STF Notícias", url: "https://noticias.stf.jus.br/postsnoticias/feed/", type: "institutional" },
  { name: "TSE Notícias", url: "https://www.tse.jus.br/comunicacao/noticias/rss-noticias", type: "institutional" },
  { name: "STJ Notícias", url: "https://www.stj.jus.br/sites/portalp/Paginas/Comunicacao/Noticias.aspx?rss=true", type: "institutional" },
  { name: "Planalto", url: "https://www.gov.br/planalto/pt-br/acompanhe-o-planalto/RSS", type: "institutional" },
  { name: "Agência Brasil Política", url: "https://agenciabrasil.ebc.com.br/rss/politica/feed.xml", type: "institutional" },
  { name: "CGU", url: "https://www.gov.br/cgu/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "TCU", url: "https://portal.tcu.gov.br/imprensa/noticias/rss.htm", type: "institutional" },
  { name: "PF", url: "https://www.gov.br/pf/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "AGU", url: "https://www.gov.br/agu/pt-br/comunicacao/noticias/RSS", type: "institutional" },
  { name: "Ministério da Justiça", url: "https://www.gov.br/mj/pt-br/assuntos/noticias/RSS", type: "institutional" },
  { name: "CNJ", url: "https://www.cnj.jus.br/feed/", type: "institutional" },
  { name: "Banco Central", url: "https://www.bcb.gov.br/api/feed/sitebcb/noticias", type: "institutional" },
  // Notícias Brasil
  { name: "G1 Política", url: "https://g1.globo.com/rss/g1/politica/", type: "news" },
  { name: "Folha Poder", url: "https://feeds.folha.uol.com.br/poder/rss091.xml", type: "news" },
  { name: "Estadão Política", url: "https://politica.estadao.com.br/rss.xml", type: "news" },
  { name: "UOL Política", url: "https://rss.uol.com.br/feed/politica.xml", type: "news" },
  { name: "CNN Brasil Política", url: "https://www.cnnbrasil.com.br/politica/feed/", type: "news" },
  { name: "Poder360", url: "https://www.poder360.com.br/feed/", type: "news" },
  { name: "Metrópoles Política", url: "https://www.metropoles.com/brasil/politica/feed", type: "news" },
  { name: "CartaCapital", url: "https://www.cartacapital.com.br/feed/", type: "news" },
  { name: "JOTA", url: "https://www.jota.info/feed", type: "news" },
  { name: "Congresso em Foco", url: "https://congressoemfoco.uol.com.br/feed/", type: "news" },
  { name: "Veja", url: "https://veja.abril.com.br/feed/", type: "news" },
  { name: "Exame Brasil", url: "https://exame.com/brasil/feed/", type: "news" },
  { name: "Valor Político", url: "https://valor.globo.com/politica/rss/", type: "news" },
  { name: "InfoMoney Política", url: "https://www.infomoney.com.br/politica/feed/", type: "news" },
  { name: "Terra Política", url: "https://www.terra.com.br/rss/0,,EI8177,00.xml", type: "news" },
  { name: "Nexo", url: "https://www.nexojornal.com.br/rss", type: "news" },
  { name: "Crusoé", url: "https://crusoe.com.br/feed/", type: "news" },
  { name: "Correio Braziliense Política", url: "https://www.correiobraziliense.com.br/rss/politica.xml", type: "news" },
  { name: "R7 Política", url: "https://noticias.r7.com/feed/politica", type: "news" },
  { name: "Band Política", url: "https://www.band.uol.com.br/rss/politica.xml", type: "news" },
  { name: "IstoÉ Política", url: "https://istoe.com.br/categoria/politica/feed/", type: "news" },
  { name: "O Globo Política", url: "https://oglobo.globo.com/rss/politica", type: "news" },
  // Internacional
  { name: "BBC Brasil", url: "https://feeds.bbci.co.uk/portuguese/rss.xml", type: "international" },
  { name: "DW Brasil", url: "https://rss.dw.com/atom/rss-br-all", type: "international" },
  { name: "Reuters World", url: "https://feeds.reuters.com/Reuters/worldNews", type: "international" },
  { name: "AP World", url: "https://feeds.apnews.com/rss/apf-topnews", type: "international" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", type: "international" },
  { name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", type: "international" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", type: "international" },
  // Agregadores (Google News com query do candidato é injetado em runtime)
];

function hashPeriod(b: ReqBody): string {
  const cats = [...(b.categories ?? [])].sort().join(",");
  return `${b.candidate_id ?? "all"}|${b.candidate_name}|${b.start_date}|${b.end_date}|${cats}`;
}

function safeNum(v: any, def = 0, min = 0, max = 100) {
  const n = Number(v);
  if (isNaN(n)) return def;
  return Math.max(min, Math.min(max, Math.round(n)));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const INSTITUTIONAL_RE = /\b(STF|TSE|PF|Senado|Câmara|Camara|Planalto|STJ|TCU|CGU|AGU|CNJ|Banco Central|Ministério|Ministerio)\b/i;

function sourceTypeFromName(name: string): RawItem["type"] {
  return INSTITUTIONAL_RE.test(name) ? "institutional" : "news";
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T23:59:59Z`);
  if (isNaN(start) || isNaN(end)) return 30;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

function targetRange(startDate: string, endDate: string): string {
  const days = daysBetween(startDate, endDate);
  if (days <= 8) return "5–30 eventos";
  if (days <= 35) return "20–80 eventos";
  if (days <= 370) return "100–500 eventos";
  return "500–5000 eventos";
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ===== RSS PARSING =====
function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function pickTag(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : "";
}

function pickLink(block: string): string {
  // RSS <link>...</link> or Atom <link href="..."/>
  const linkText = pickTag(block, "link");
  if (linkText && linkText.startsWith("http")) return linkText;
  const m = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : linkText;
}

function parseFeed(xml: string, source: string, type: RawItem["type"]): RawItem[] {
  const items: RawItem[] = [];
  const itemRe = /<(item|entry)[\s\S]*?<\/(item|entry)>/gi;
  const blocks = xml.match(itemRe) ?? [];
  for (const block of blocks) {
    const title = pickTag(block, "title");
    if (!title) continue;
    const url = pickLink(block);
    const pub = pickTag(block, "pubDate") || pickTag(block, "published") || pickTag(block, "updated");
    const desc = pickTag(block, "description") || pickTag(block, "summary") || pickTag(block, "content");
    items.push({
      title: title.slice(0, 400),
      url: url.slice(0, 800),
      source,
      type,
      pub_date: pub || undefined,
      snippet: desc ? desc.slice(0, 600) : undefined,
    });
  }
  return items;
}

async function fetchFeed(name: string, url: string, type: RawItem["type"]): Promise<RawItem[]> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPoliticoRadar/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseFeed(xml, name, type);
  } catch {
    return [];
  }
}

// ===== CANDIDATE MATCHING (aliases + fuzzy) =====
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAliases(fullName: string): string[] {
  const norm = normalize(fullName);
  const parts = norm.split(" ").filter((p) => p.length >= 3);
  const aliases = new Set<string>([norm]);
  const compact = norm.replace(/\s+/g, " ");
  if (parts.length >= 2) {
    aliases.add(`${parts[0]} ${parts[parts.length - 1]}`); // first + last
    aliases.add(parts[parts.length - 1]); // last name
  }
  if (parts[0]) aliases.add(parts[0]);
  if (compact.includes("flavio") && compact.includes("bolsonaro")) {
    ["flavio bolsonaro", "flávio bolsonaro", "senador flavio bolsonaro", "senador flávio bolsonaro", "flavio nantes bolsonaro", "flávio nantes bolsonaro"].forEach((a) => aliases.add(normalize(a)));
  }
  if (compact.includes("lula") || compact.includes("luiz inacio")) {
    ["lula", "luiz inacio lula da silva", "luiz inácio lula da silva", "presidente lula"].forEach((a) => aliases.add(normalize(a)));
  }
  if (compact.includes("bolsonaro") && !compact.includes("flavio")) {
    ["jair bolsonaro", "ex presidente bolsonaro", "presidente bolsonaro", "bolsonaro"].forEach((a) => aliases.add(normalize(a)));
  }
  return Array.from(aliases).filter((a) => a.length >= 4);
}

function similarity(a: string, b: string): number {
  const aa = normalize(a);
  const bb = normalize(b);
  if (!aa || !bb) return 0;
  if (aa.includes(bb) || bb.includes(aa)) return 1;
  const aTokens = new Set(aa.split(" ").filter((x) => x.length >= 3));
  const bTokens = new Set(bb.split(" ").filter((x) => x.length >= 3));
  const intersection = [...aTokens].filter((x) => bTokens.has(x)).length;
  const union = new Set([...aTokens, ...bTokens]).size || 1;
  const tokenScore = intersection / union;
  let prefixMatches = 0;
  for (const at of aTokens) {
    if ([...bTokens].some((bt) => at.startsWith(bt) || bt.startsWith(at))) prefixMatches++;
  }
  return Math.max(tokenScore, prefixMatches / Math.max(1, aTokens.size));
}

function matchesCandidate(item: RawItem, aliases: string[]): boolean {
  const hay = normalize(`${item.title} ${item.snippet ?? ""}`);
  return aliases.some((a) => hay.includes(a) || similarity(a, hay) > 0.75);
}

function eventMatchesCandidate(event: any, aliases: string[]): boolean {
  const hay = normalize(`${event.title ?? ""} ${event.summary ?? ""} ${(event.entities ?? []).join(" ")}`);
  return aliases.some((a) => hay.includes(a) || similarity(a, hay) > 0.75);
}

function inDateRange(item: RawItem, startMs: number, endMs: number): boolean {
  if (!item.pub_date) return true; // keep if unknown — AI will discard
  const t = Date.parse(item.pub_date);
  if (isNaN(t)) return true;
  return t >= startMs && t <= endMs;
}

// ===== AI normalization =====
function extractText(provider: string, data: any): string {
  if (provider === "gemini") {
    return data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? "").join("") ?? "";
  }
  return data?.choices?.[0]?.message?.content ?? "";
}

function normalizeEvents(raw: any[]): any[] {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && typeof e.title === "string" && e.title.length > 3)
    .map((e, i) => {
      const sources = Array.isArray(e.sources)
        ? e.sources
            .map((s: any) => {
              if (typeof s === "string") return { name: s, url: "", type: sourceTypeFromName(s) };
              return { name: String(s?.name ?? s?.source ?? "Fonte"), url: String(s?.url ?? ""), type: s?.type ?? sourceTypeFromName(String(s?.name ?? "")) };
            })
            .filter((s: any) => s.name)
        : [];
      const source_count = sources.length || safeNum(e.source_count, 1, 0, 999);
      const institutional_sources = sources.filter((s: any) => s.type === "institutional").length;
      const social_score = safeNum(e.social_score, 0);
      const media_diversity = new Set(sources.map((s: any) => s.name)).size;
      const computed = source_count * 2 + institutional_sources * 10 + social_score * 0.3 + media_diversity * 1.5;
      const importance = safeNum(e.importance, Math.min(100, Math.round(computed)));
      return {
        id: e.id ?? `${Date.now()}-${i}`,
        title: String(e.title).slice(0, 280),
        summary: String(e.summary ?? "").slice(0, 1500),
        category: String(e.category ?? "Outros"),
        event_date: e.event_date ?? e.date ?? null,
        source_count,
        institutional_sources,
        social_score,
        importance,
        political_impact: e.political_impact ? String(e.political_impact).slice(0, 600) : "",
        entities: Array.isArray(e.entities) ? e.entities.slice(0, 10).map((x: any) => String(x).slice(0, 80)) : [],
        sources: sources.slice(0, 25).map((s: any) => ({
          name: String(s.name).slice(0, 120),
          url: String(s.url ?? "").slice(0, 600),
          type: s.type ?? "news",
        })),
      };
    })
    .sort((a, b) => {
      const ta = a.event_date ? Date.parse(a.event_date) : 0;
      const tb = b.event_date ? Date.parse(b.event_date) : 0;
      return tb - ta;
    });
}

function buildRssFallbackEvents(items: RawItem[], candidateName: string, aliases: string[], startMs: number, endMs: number): any[] {
  const primary = items.filter((it) => matchesCandidate(it, aliases) && inDateRange(it, startMs, endMs));
  const relaxed = primary.length > 0 ? primary : items.filter((it) => matchesCandidate(it, aliases));
  const seen = new Set<string>();
  return relaxed
    .filter((it) => {
      const key = normalize(it.url || it.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 120)
    .map((it, i) => ({
      id: `rss-fallback-${Date.now()}-${i}`,
      title: it.title,
      summary: it.snippet || `Notícia pública envolvendo ${candidateName}, detectada automaticamente em fonte RSS externa.`,
      category: it.type === "institutional" ? "Institucional" : "Outros",
      event_date: it.pub_date && !isNaN(Date.parse(it.pub_date)) ? new Date(it.pub_date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      source_count: 1,
      institutional_sources: it.type === "institutional" ? 1 : 0,
      social_score: it.type === "institutional" ? 55 : 35,
      importance: it.type === "institutional" ? 72 : 52,
      political_impact: it.type === "institutional" ? "Evento institucional detectado em fonte pública." : "Evento noticioso detectado em fonte pública.",
      entities: [candidateName, it.source],
      sources: [{ name: it.source, url: it.url, type: it.type }],
    }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "missing_auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CEREBRAS_KEY = Deno.env.get("CEREBRAS_API_KEY");
    const GROQ_KEY = Deno.env.get("GROQ_API_KEY");
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!CEREBRAS_KEY && !GROQ_KEY && !GEMINI_KEY) {
      return jsonResponse({ error: "ai_unconfigured", fallback: true, events: [], cached: false, count: 0 });
    }

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "invalid_auth" }, 401);
    const userId = userData.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = (await req.json().catch(() => null)) as ReqBody | null;
    if (!body?.candidate_name || !body?.start_date || !body?.end_date) {
      return jsonResponse({ error: "campos obrigatórios: candidate_name, start_date, end_date" }, 400);
    }

    const period_hash = hashPeriod(body);
    const startMs = Date.parse(body.start_date + "T00:00:00Z");
    const endMs = Date.parse(body.end_date + "T23:59:59Z");

    console.log("LOG 1: candidate_name =", body.candidate_name);
    console.log("LOG 2: period =", { start_date: body.start_date, end_date: body.end_date, force_refresh: !!body.force_refresh });

    // Cache lookup (30 min — TTL menor pra refletir realtime)
    if (!body.force_refresh) {
      const { data: cached } = await admin
        .from("radar_cache")
        .select("response_json,expires_at,event_count,created_at")
        .eq("user_id", userId)
        .eq("period_hash", period_hash)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      const cachedEvents = Array.isArray(cached?.response_json) ? cached.response_json : [];
      if (cachedEvents.length > 0) {
        return jsonResponse({
          events: cachedEvents,
          cached: true,
          cached_at: cached.created_at,
          count: cachedEvents.length,
        });
      }
      if (cached?.response_json) console.log("Skipping empty cache");
    } else {
      console.log("[RADAR] force_refresh=true: ignorando cache e rodando IA novamente");
    }

    // ===== 1. FETCH RSS EM PARALELO =====
    const aliases = buildAliases(body.candidate_name);
    // Adicionar Google News query do candidato
    const googleNewsQuery = encodeURIComponent(body.candidate_name);
    const dynamicFeeds = [
      ...FEEDS,
      {
        name: "Google News BR",
        url: `https://news.google.com/rss/search?q=${googleNewsQuery}&hl=pt-BR&gl=BR&ceid=BR:pt-419`,
        type: "aggregator" as const,
      },
    ];

    const t0 = Date.now();
    const allItems = (await Promise.all(dynamicFeeds.map((f) => fetchFeed(f.name, f.url, f.type)))).flat();
    const fetchMs = Date.now() - t0;

    // Filtrar por candidato + período
    const filtered = allItems.filter((it) => matchesCandidate(it, aliases) && inDateRange(it, startMs, endMs));

    // Dedup por URL
    const seen = new Set<string>();
    const unique = filtered.filter((it) => {
      const k = it.url || it.title;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    console.log(`[RADAR] ${body.candidate_name}: ${allItems.length} brutos, ${unique.length} filtrados em ${fetchMs}ms`);

    // ===== 2. PROMPT IA =====
    const catFilter =
      body.categories && body.categories.length > 0 && !body.categories.includes("Todos")
        ? `Filtrar APENAS para as categorias: ${body.categories.join(", ")}.`
        : "Cobrir todas as categorias políticas.";

    const systemPrompt = `Você é um pesquisador político brasileiro. Sua tarefa: agrupar notícias coletadas em tempo real em EVENTOS POLÍTICOS reais.
- Agrupe semanticamente notícias que falam do MESMO acontecimento (cosine similarity alta).
- Deduplique.
- Classifique cada evento em categoria.
- Gere resumo factual em português.
- Use APENAS as fontes/URLs fornecidas — NUNCA invente.
- Quando não houver notícias suficientes nas fontes, complemente com eventos reais públicos do seu conhecimento, mas marque tais sources com type="news" e nome do veículo real.
- Responda EXCLUSIVAMENTE com JSON válido.`;

    const sourcesPayload = unique.slice(0, 220).map((it) => ({
      title: it.title,
      url: it.url,
      source: it.source,
      type: it.type,
      date: it.pub_date ?? null,
      snippet: it.snippet?.slice(0, 220) ?? "",
    }));

    const userPrompt = `Candidato: "${body.candidate_name}"
Período: ${body.start_date} até ${body.end_date}
${catFilter}

Notícias brutas coletadas via RSS (${sourcesPayload.length} itens):
${JSON.stringify(sourcesPayload)}

Tarefa:
1. Agrupe as notícias acima por evento (mesmo acontecimento = 1 evento).
2. Para cada evento, liste TODAS as sources que cobrem aquele evento (do material fornecido).
3. Para períodos longos com cobertura RSS insuficiente, complemente com eventos REAIS conhecidos publicamente nesse período envolvendo "${body.candidate_name}".
4. Retorne entre 30 e 120 eventos (mais para períodos longos).

Formato OBRIGATÓRIO:
{
  "events": [
    {
      "title": "string (até 200 chars)",
      "summary": "string (2-5 frases factuais)",
      "category": "Eleições|STF|TSE|PF|CPI|Congresso|Executivo|Economia|Escândalos|Prisões|Julgamentos|Internacional|Declarações|Outros",
      "event_date": "YYYY-MM-DD",
      "political_impact": "string curta sobre impacto político",
      "entities": ["pessoa/órgão", "..."],
      "social_score": 0,
      "sources": [
        { "name": "Nome do veículo", "url": "https://...", "type": "institutional|news|international|aggregator" }
      ]
    }
  ]
}
Ordene do mais recente para o mais antigo.`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    async function callOpenAICompat(provider: "cerebras" | "groq", model: string, key: string) {
      const res = await fetch(provider === "cerebras" ? CEREBRAS_URL : GROQ_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: provider === "cerebras" ? 8192 : 6144,
        }),
        signal: AbortSignal.timeout(provider === "cerebras" ? 40_000 : 35_000),
      });
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider, model };
    }

    async function callGemini(model: string, key: string) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(40_000),
        },
      );
      const raw = await res.text();
      return { ok: res.ok, status: res.status, raw, provider: "gemini", model };
    }

    const attempts: Array<() => Promise<{ ok: boolean; status: number; raw: string; provider: string; model: string }>> = [];
    if (CEREBRAS_KEY) CEREBRAS_MODELS.forEach((m) => attempts.push(() => callOpenAICompat("cerebras", m, CEREBRAS_KEY)));
    if (GROQ_KEY) GROQ_MODELS.forEach((m) => attempts.push(() => callOpenAICompat("groq", m, GROQ_KEY)));
    if (GEMINI_KEY) GEMINI_MODELS.forEach((m) => attempts.push(() => callGemini(m, GEMINI_KEY)));

    let text = "{}";
    let usedProvider = "none";
    let lastFailure = "";
    for (const attempt of attempts) {
      try {
        const result = await attempt();
        if (!result.ok) {
          lastFailure = `${result.provider}:${result.model} HTTP ${result.status} ${result.raw.slice(0, 200)}`;
          console.warn(`[RADAR-AI] ${lastFailure}`);
          if (result.status === 429 || result.status === 402) await sleep(900);
          continue;
        }
        const data = JSON.parse(result.raw);
        text = extractText(result.provider, data) || "{}";
        usedProvider = `${result.provider}:${result.model}`;
        break;
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        console.warn(`[RADAR-AI] provider failed: ${lastFailure}`);
      }
    }

    if (usedProvider === "none") {
      return jsonResponse({
        error: "ai_unavailable",
        message: "Todos os provedores de IA estão temporariamente indisponíveis. Tente novamente em instantes.",
        detail: lastFailure.slice(0, 300),
        fallback: true,
        events: [],
        cached: false,
        count: 0,
        raw_items: unique.length,
      });
    }

    let parsed: any = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          parsed = { events: [] };
        }
      }
    }

    const events = normalizeEvents(parsed.events ?? parsed);

    // Cache 30 min
    await admin.from("radar_cache").upsert(
      {
        user_id: userId,
        candidate_id: body.candidate_id ?? null,
        candidate_name: body.candidate_name,
        period_hash,
        start_date: body.start_date,
        end_date: body.end_date,
        categories: body.categories ?? [],
        response_json: events,
        event_count: events.length,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      { onConflict: "user_id,period_hash" },
    );

    return jsonResponse({
      events,
      cached: false,
      count: events.length,
      provider: usedProvider,
      raw_items: unique.length,
      sources_fetched: dynamicFeeds.length,
      fetch_ms: fetchMs,
    });
  } catch (e) {
    console.error("[RADAR-AI] erro inesperado", e);
    return jsonResponse({
      error: "radar_failed",
      message: "O Radar Político não conseguiu concluir a busca agora. Tente novamente em instantes.",
      detail: (e as Error).message,
      fallback: true,
      events: [],
      cached: false,
      count: 0,
    });
  }
});
