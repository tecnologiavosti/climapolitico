// backfill-radar-historical
// ============================================================================
// Backfill histórico de eventos políticos via GDELT DOC API (gratuita).
// Executar em lotes via body: { candidate_id, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }
// Insere clusters em political_events + event_sources.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const UA = "ClimaPoliticoBot/1.0";

const CATEGORIES = ["Eleições","STF","TSE","PF","CPI","Congresso","Executivo","Economia","Escândalo","Prisão","Julgamento","Internacional","Outros"];
const BLOCK = ["futebol","gol","seleção","copa","libertadores","novela","bbb","horóscopo","cantor","cantora","aniversário"];
const INSTITUTIONAL = ["stf.jus.br","tse.jus.br","senado.leg.br","camara.leg.br","gov.br","pf.gov.br","planalto.gov.br","agenciabrasil.ebc.com.br"];
const MAJOR = ["g1.globo.com","globo.com","uol.com.br","folha.uol.com.br","estadao.com.br","cnnbrasil.com.br","poder360.com.br","metropoles.com","veja.abril.com.br","cartacapital.com.br","oglobo.globo.com"];

function normalize(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}
function isBlocked(t: string) { const n = normalize(t); return BLOCK.some((k) => n.includes(k)); }

async function fetchGdelt(query: string, startYmd: string, endYmd: string) {
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query + " sourcelang:Portuguese sourcecountry:BR")}&mode=ArtList&maxrecords=250&format=JSON&startdatetime=${startYmd.replace(/-/g, "")}000000&enddatetime=${endYmd.replace(/-/g, "")}235959&sort=DateDesc`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const j = await res.json();
    return Array.isArray(j?.articles) ? j.articles : [];
  } catch { return []; }
}

function classifyDomain(u: string) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

interface Item { title: string; url: string; published_at: string; domain: string; source_name: string }

function cluster(items: Item[]) {
  const groups = new Map<string, Item[]>();
  for (const it of items) {
    const day = it.published_at.slice(0, 10);
    const tokens = normalize(it.title).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 4).slice(0, 3).sort().join("-");
    const key = `${day}::${tokens || normalize(it.title).slice(0, 30)}`;
    const arr = groups.get(key) ?? []; arr.push(it); groups.set(key, arr);
  }
  return groups;
}

async function classify(headlines: string[], name: string) {
  const prompt = `Notícias históricas sobre "${name}". Determine se é evento político relevante.
Ignore: esporte, entretenimento, agenda comum.
Retorne JSON: {"title":"título","summary":"1-2 frases","category":"UMA de [${CATEGORIES.join(", ")}]","relevance":0-100}
Manchetes:
${headlines.slice(0, 8).map((h, i) => `${i+1}. ${h}`).join("\n")}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const p = JSON.parse(d?.choices?.[0]?.message?.content ?? "{}");
    return {
      title: String(p.title ?? headlines[0]).slice(0, 200),
      summary: String(p.summary ?? ""),
      category: CATEGORIES.includes(p.category) ? p.category : "Outros",
      relevance: Math.max(0, Math.min(100, Number(p.relevance) || 0)),
    };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { candidate_id, start, end, min_relevance = 40 } = await req.json();
    if (!candidate_id || !start || !end) {
      return new Response(JSON.stringify({ error: "candidate_id, start, end required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: cand } = await supabase.from("candidates").select("id,user_id,full_name").eq("id", candidate_id).maybeSingle();
    if (!cand) return new Response(JSON.stringify({ error: "candidate not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const articles = await fetchGdelt(`"${cand.full_name}"`, start, end);
    const items: Item[] = [];
    for (const a of articles) {
      if (!a?.title || !a?.url) continue;
      if (isBlocked(a.title)) continue;
      const d = a.seendate?.match(/^(\d{4})(\d{2})(\d{2})/);
      if (!d) continue;
      const iso = `${d[1]}-${d[2]}-${d[3]}T12:00:00Z`;
      items.push({ title: a.title, url: a.url, published_at: iso, domain: classifyDomain(a.url), source_name: a.domain || classifyDomain(a.url) });
    }

    const clusters = cluster(items);
    let inserted = 0;
    for (const [key, group] of clusters) {
      const day = key.split("::")[0];
      const byDomain = new Map<string, Item>();
      for (const it of group) if (!byDomain.has(it.domain)) byDomain.set(it.domain, it);
      const sources = [...byDomain.values()];
      const institutional = sources.filter((s) => INSTITUTIONAL.some((d) => s.domain.endsWith(d))).length;
      const major = sources.filter((s) => MAJOR.some((d) => s.domain.endsWith(d))).length;
      if (sources.length < 2 && institutional === 0 && major === 0) continue;

      const cls = await classify(sources.map((s) => `${s.title} (${s.domain})`), cand.full_name);
      if (!cls || cls.relevance < min_relevance) continue;

      const importance = Math.round(Math.min(100, 0.3 * Math.min(100, sources.length * 10) + 0.25 * Math.min(100, institutional * 25) + 0.45 * cls.relevance));
      const sourcesJson = sources.map((s) => ({ source_name: s.source_name, url: s.url, type: INSTITUTIONAL.some((d) => s.domain.endsWith(d)) ? "institutional" : "news", published_at: s.published_at }));

      const { data: existing } = await supabase
        .from("political_events").select("id")
        .eq("candidate_id", cand.id).eq("user_id", cand.user_id)
        .gte("event_date", `${day}T00:00:00Z`).lt("event_date", `${day}T23:59:59Z`)
        .ilike("title", `%${cls.title.slice(0, 40)}%`).limit(1).maybeSingle();
      if (existing?.id) continue;

      const { data: created } = await supabase.from("political_events").insert({
        candidate_id: cand.id, user_id: cand.user_id,
        title: cls.title, event_name: cls.title, summary: cls.summary, ai_summary: cls.summary,
        category: cls.category, category_v2: cls.category,
        event_date: `${day}T12:00:00Z`, event_type: "noticia",
        source_count: sources.length, total_sources: sources.length, institutional_sources: institutional,
        social_score: 0, importance, importance_score: importance,
        status: "active", sources_json: sourcesJson, detection_source: "backfill-gdelt",
      }).select("id").single();

      if (created?.id) {
        const rows = sources.map((s) => ({
          event_id: created.id, source_name: s.source_name,
          source_type: INSTITUTIONAL.some((d) => s.domain.endsWith(d)) ? "institutional" : "news",
          url: s.url, title: s.title, published_at: s.published_at,
          is_institutional: INSTITUTIONAL.some((d) => s.domain.endsWith(d)),
          is_major_media: MAJOR.some((d) => s.domain.endsWith(d)),
          credibility_score: INSTITUTIONAL.some((d) => s.domain.endsWith(d)) ? 0.95 : 0.7,
        }));
        await supabase.from("event_sources").upsert(rows, { onConflict: "event_id,url" });
        inserted++;
      }
    }

    return new Response(JSON.stringify({ ok: true, candidate: cand.full_name, period: `${start}..${end}`, articles: items.length, clusters: clusters.size, inserted }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
