// IA de Pesquisa Histórica — análise factual e contextual.
// Combina pesquisa externa leve (GDELT + Google News + Wikipedia) com o
// conhecimento histórico da IA para produzir um relatório de inteligência política.
// NÃO usa coletas internas. NÃO inventa sentimento popular.
// Body: { candidateId, startDate, endDate }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function ymd(d: string | Date): string {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toISOString().slice(0, 10);
}

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface ExternalDoc {
  title: string;
  url: string;
  date: string;
  source: string;
  domain?: string;
  snippet?: string;
}

function gdeltStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}
function parseGdeltDate(s: string): string {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return new Date().toISOString();
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function fetchGdelt(name: string, start: Date, end: Date, max = 200): Promise<ExternalDoc[]> {
  try {
    const q = `"${name}" sourcelang:Portuguese sourcecountry:BR`;
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=${max}&format=JSON&startdatetime=${gdeltStamp(start)}&enddatetime=${gdeltStamp(end)}&sort=DateDesc`;
    const r = await fetch(url, {
      headers: { "Accept": "application/json", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return [];
    const json = await r.json();
    const arts = Array.isArray(json?.articles) ? json.articles : [];
    return arts.filter((a: any) => a?.title && a?.url).map((a: any) => ({
      title: String(a.title), url: String(a.url), date: parseGdeltDate(a.seendate),
      source: "GDELT", domain: a.domain || undefined,
    }));
  } catch (e) {
    console.warn(`[hist/GDELT] ${(e as Error).message}`);
    return [];
  }
}

function parseRss(xml: string): ExternalDoc[] {
  const items: ExternalDoc[] = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const it = m[1];
    const title = it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || "";
    const link = it.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim() || "";
    const pub = it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || "";
    const src = it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() || "Google News";
    const desc = it.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1]?.replace(/<[^>]*>/g, "").slice(0, 300) || "";
    if (!title || !link) continue;
    items.push({
      title: title.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"),
      url: link,
      date: pub ? new Date(pub).toISOString() : new Date().toISOString(),
      source: "Google News", domain: src, snippet: desc || undefined,
    });
  }
  return items;
}

async function fetchGoogleNews(name: string, start: Date, end: Date): Promise<ExternalDoc[]> {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${name}"`)}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ClimaPolitico/1.0)" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const all = parseRss(xml);
    const s = start.getTime(); const e = end.getTime();
    return all.filter((d) => { const t = new Date(d.date).getTime(); return t >= s && t <= e; });
  } catch (e) {
    console.warn(`[hist/GoogleNews] ${(e as Error).message}`);
    return [];
  }
}

async function fetchWikipedia(name: string): Promise<{ extract: string; url: string } | null> {
  try {
    const direct = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(name)}`, {
      headers: { "User-Agent": "ClimaPolitico/1.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (direct.ok) {
      const d = await direct.json();
      if (d?.extract) return { extract: String(d.extract), url: d.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(name)}` };
    }
    const s = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(name)}&format=json&srlimit=1`, {
      headers: { "User-Agent": "ClimaPolitico/1.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!s.ok) return null;
    const j = await s.json();
    const t = j?.query?.search?.[0]?.title;
    if (!t) return null;
    const sec = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`, {
      headers: { "User-Agent": "ClimaPolitico/1.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!sec.ok) return null;
    const d2 = await sec.json();
    return d2?.extract ? { extract: String(d2.extract), url: d2.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(t)}` } : null;
  } catch (e) {
    console.warn(`[hist/Wikipedia] ${(e as Error).message}`);
    return null;
  }
}

function dedupeDocs(docs: ExternalDoc[]): ExternalDoc[] {
  const seen = new Set<string>();
  const out: ExternalDoc[] = [];
  for (const d of docs) {
    const key = (d.url || d.title).toLowerCase().slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key); out.push(d);
  }
  return out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userRes?.user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const { candidateId, startDate, endDate } = body;
    if (!candidateId || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: "candidateId, startDate, endDate são obrigatórios" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: cand } = await supabase.from("candidates").select("id, full_name, party, region").eq("id", candidateId).maybeSingle();
    if (!cand) return new Response(JSON.stringify({ error: "Candidato não encontrado" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const start = new Date(startDate);
    const end = new Date(endDate);
    const name = cand.full_name as string;

    const cacheKey = `hist_ctx:v2:${await sha256(`${candidateId}:${ymd(start)}:${ymd(end)}`)}`;
    const { data: cached } = await supabase.from("analysis_cache")
      .select("result, hit_count").eq("cache_key", cacheKey)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (cached?.result) {
      await supabase.from("analysis_cache").update({
        last_hit_at: new Date().toISOString(),
        hit_count: Number(cached.hit_count || 0) + 1,
      }).eq("cache_key", cacheKey);
      return new Response(JSON.stringify({ ...(cached.result as any), fromCache: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [gdeltDocs, googleNewsDocs, wiki] = await Promise.all([
      fetchGdelt(name, start, end, 150),
      fetchGoogleNews(name, start, end),
      fetchWikipedia(name),
    ]);

    const allDocs = dedupeDocs([...gdeltDocs, ...googleNewsDocs]);
    const sources = {
      gdelt: gdeltDocs.length,
      googleNews: googleNewsDocs.length,
      wikipedia: !!wiki,
      total: allDocs.length,
    };

    const docsForAI = allDocs.slice(0, 50).map((d) => ({
      title: d.title, date: d.date.slice(0, 10), source: d.source, domain: d.domain, snippet: d.snippet,
    }));

    const period = { start: ymd(start), end: ymd(end) };

    let analysis: any = null;
    let provider = "none";
    let aiError: any = null;

    const aiInput = {
      candidate: name,
      party: cand.party || null,
      region: cand.region || null,
      period,
      wikipedia: wiki ? { extract: wiki.extract.slice(0, 1500), url: wiki.url } : null,
      externalSources: sources,
      documents: docsForAI,
    };

    const prompt = `Você é um analista político brasileiro sênior, especialista em CONTEXTO HISTÓRICO e INTELIGÊNCIA POLÍTICA. Sua tarefa é produzir um RELATÓRIO HISTÓRICO FACTUAL sobre o político abaixo, no período indicado.

Use seu conhecimento histórico consolidado do Brasil + as referências externas fornecidas (quando úteis). Esta análise NÃO depende das menções coletadas, NÃO mede sentimento popular, NÃO inventa opiniões da população.

DADOS:
${JSON.stringify(aiInput)}

REGRAS CRÍTICAS:
- PROIBIDO afirmar o que "o povo pensava", "a população acreditava", "as redes reagiam", "o brasileiro sentia", "havia uma percepção popular", etc.
- PROIBIDO inventar frases populares, humor coletivo, clima emocional, aprovação/rejeição.
- PROIBIDO usar porcentagens de sentimento ou métricas de engajamento.
- PERMITIDO: fatos, eventos, decisões institucionais, cargos, contexto governamental, repercussão objetiva (votações, decisões judiciais, atos oficiais), interpretação histórica consolidada.
- Se uma data exata não for conhecida com segurança, use AAAA-MM ou AAAA.
- Tom: relatório de inteligência política, sóbrio, objetivo, factual. PT-BR.
- Mesmo que NÃO existam documentos externos, produza a análise com base no seu conhecimento histórico do político e do período.

Retorne ESTRITAMENTE JSON neste formato:
{
  "historicalContext": {
    "role": "Cargo/posição institucional ocupada pelo político durante o período (ex: 'Presidente do Novo Banco de Desenvolvimento dos BRICS').",
    "relevance": "Relevância política e papel no cenário nacional/internacional (2-4 frases factuais)."
  },
  "politicalScene": {
    "federalGovernment": "Quem governava o Brasil e contexto do governo federal no período.",
    "mainDebates": ["Principal debate nacional 1", "Principal debate nacional 2", "..."],
    "environment": "Ambiente político do período (2-4 frases): eleições, reformas, crises, decisões judiciais, cenário internacional relevante."
  },
  "timeline": [
    { "date": "AAAA-MM-DD ou AAAA-MM", "title": "Título objetivo do evento", "description": "Descrição factual do que aconteceu.", "relevance": "Relevância histórica/institucional do evento para o político." }
  ],
  "associatedThemes": [
    { "theme": "economia | segurança | educação | relações internacionais | corrupção | reformas | democracia | eleições | infraestrutura | saúde | meio ambiente | outro", "description": "Como esse tema se conectava ao político no período (1-2 frases factuais)." }
  ],
  "politicalImpact": {
    "institutional": "Impacto institucional concreto da atuação do político no período.",
    "governmental": "Repercussão governamental objetiva (decisões, votações, atos oficiais, acordos).",
    "influence": "Influência política objetiva exercida (sem especulação emocional)."
  },
  "historicalInterpretation": "Interpretação histórica consolidada do período em relação ao político (4-6 frases). Como historiadores e analistas políticos enquadram este momento. Sem opiniões populares.",
  "executiveSummary": "Resumo executivo final (máximo 300 palavras) cobrindo: quem era, o que fazia, o que acontecia no país, qual sua relevância institucional. Tom de briefing de inteligência política.",
  "dataNote": "Frase curta indicando as bases usadas (ex: 'Análise baseada em conhecimento histórico consolidado e N referências externas (GDELT/Google News/Wikipedia).')."
}`;

    try {
      const r = await callAICerebrasFirst({
        systemMsg: "Você é um analista político brasileiro sênior, especialista em história política do Brasil e inteligência política. Produza relatórios FACTUAIS, sem inventar opiniões populares. Responda em PT-BR. Retorne APENAS JSON válido.",
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 4000,
        temperature: 0.4,
        tag: "hist-context",
      });
      try {
        analysis = JSON.parse(r.content);
        provider = `${r.provider}:${r.model}`;
      } catch {
        aiError = { errorType: "AI_PARSE", userMessage: "A IA retornou resposta em formato inválido. Tente novamente." };
      }
    } catch (e) {
      aiError = { errorType: "AI_UNAVAILABLE", userMessage: `Provedores de IA indisponíveis: ${(e as Error).message}` };
    }

    const responsePayload = {
      candidate: { id: cand.id, name, party: cand.party, region: cand.region },
      period,
      sources,
      wikipedia: wiki,
      documents: allDocs.slice(0, 40),
      analysis,
      aiError,
      provider,
      fromCache: false,
    };

    if (analysis) {
      await supabase.from("analysis_cache").upsert({
        cache_key: cacheKey,
        analysis_type: "historical_context",
        result: responsePayload,
        provider,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }, { onConflict: "cache_key" });
    }

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[historical-comparison] fatal", e);
    return new Response(JSON.stringify({
      analysis: null,
      aiError: { errorType: "EDGE_FUNCTION_ERROR", message: String(e), userMessage: "Erro interno na função de pesquisa histórica." },
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
