// run-radar-pipeline
// ============================================================================
// Novo pipeline da aba "Radar Político" (substitui a antiga "Picos de Menções").
//
// Fluxo:
//   1) Para cada candidato em escopo, buscar Google News RSS (pt-BR) com o nome
//   2) Agrupar headlines por dia e por similaridade simples
//   3) Pedir ao Gemini (Lovable AI Gateway) para classificar/filtrar/resumir
//   4) Calcular social_score a partir de social_interactions (SSOT)
//   5) Calcular importance composto e fazer upsert em political_events
//   6) Popular sources_json (inline) + event_sources
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const UA = "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)";
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_FEED = 80;
const DEFAULT_LOOKBACK_DAYS = 14;

const CATEGORIES = [
  "Eleições","STF","TSE","PF","CPI","Congresso","Economia",
  "Escândalo","Prisão","Julgamento","Internacional","Outros",
];

const INSTITUTIONAL_DOMAINS = [
  "stf.jus.br","tse.jus.br","senado.leg.br","camara.leg.br","gov.br",
  "pf.gov.br","cgu.gov.br","tcu.gov.br","justica.gov.br","planalto.gov.br",
];
const MAJOR_NEWS_DOMAINS = [
  "g1.globo.com","globo.com","uol.com.br","folha.uol.com.br","estadao.com.br",
  "cnnbrasil.com.br","poder360.com.br","metropoles.com","veja.abril.com.br",
  "reuters.com","oglobo.globo.com",
];

interface NewsItem {
  title: string;
  url: string;
  source_name: string;
  published_at: string;
  domain: string;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function stripTags(s: string): string {
  return (s || "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function classifyDomain(url: string): { domain: string; type: "institutional"|"news"|"social" } {
  try {
    const u = new URL(url);
    const d = u.hostname.replace(/^www\./, "");
    if (INSTITUTIONAL_DOMAINS.some((id) => d.endsWith(id))) return { domain: d, type: "institutional" };
    if (MAJOR_NEWS_DOMAINS.some((nd) => d.endsWith(nd))) return { domain: d, type: "news" };
    return { domain: d, type: "news" };
  } catch {
    return { domain: "unknown", type: "news" };
  }
}

async function fetchGoogleNews(query: string, lookbackDays: number): Promise<NewsItem[]> {
  const q = encodeURIComponent(`"${query}" when:${lookbackDays}d`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=pt-BR&gl=BR&ceid=BR:pt-419`;
  try {
    const res = await timeout(fetch(url, { headers: { "User-Agent": UA } }), FETCH_TIMEOUT_MS);
    if (!res.ok) return [];
    const xml = await res.text();
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let m: RegExpExecArray | null;
    while ((m = itemRegex.exec(xml)) && items.length < MAX_ITEMS_PER_FEED) {
      const block = m[1];
      const title = stripTags((block.match(/<title>([\s\S]*?)<\/title>/)?.[1]) || "");
      const link = stripTags((block.match(/<link>([\s\S]*?)<\/link>/)?.[1]) || "");
      const pub = stripTags((block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]) || "");
      const src = stripTags((block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]) || "");
      if (!title || !link) continue;
      const { domain } = classifyDomain(link);
      items.push({
        title,
        url: link,
        source_name: src || domain,
        published_at: pub ? new Date(pub).toISOString() : new Date().toISOString(),
        domain,
      });
    }
    return items;
  } catch {
    return [];
  }
}

function normalizeTitle(t: string): string {
  return t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

function clusterByDay(items: NewsItem[]): Map<string, NewsItem[]> {
  const groups = new Map<string, NewsItem[]>();
  for (const it of items) {
    const day = it.published_at.slice(0, 10);
    const normTitle = normalizeTitle(it.title);
    const keyTokens = normTitle.split(" ").filter((w) => w.length > 4).slice(0, 4).sort().join("-");
    const key = `${day}::${keyTokens}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  return groups;
}

async function classifyCluster(headlines: string[], candidateName: string): Promise<{
  title: string;
  summary: string;
  category: string;
  importance_signal: number;
  is_relevant: boolean;
} | null> {
  const prompt = `Analise estas manchetes de notícias brasileiras sobre "${candidateName}". Retorne SOMENTE um JSON com este formato:
{"title": "...", "summary": "...", "category": "...", "importance_signal": 0-100, "is_relevant": true/false}

Regras:
- title: título canônico curto (máx 90 chars)
- summary: resumo de 1-2 frases em PT-BR
- category: UMA de [${CATEGORIES.join(", ")}]
- importance_signal: 0-100 (75+ para crise nacional, STF, PF, CPI, escândalo, prisão; 45-75 para decisão relevante; <45 para rotina)
- is_relevant: false APENAS se for agenda comum, post viral sem evento, comício rotineiro

Manchetes:
${headlines.slice(0, 12).map((h, i) => `${i + 1}. ${h}`).join("\n")}`;

  try {
    const res = await timeout(fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    }), 20_000);
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    return {
      title: String(parsed.title ?? headlines[0]).slice(0, 200),
      summary: String(parsed.summary ?? ""),
      category: CATEGORIES.includes(parsed.category) ? parsed.category : "Outros",
      importance_signal: Math.max(0, Math.min(100, Number(parsed.importance_signal) || 0)),
      is_relevant: parsed.is_relevant !== false,
    };
  } catch {
    return null;
  }
}

async function calcSocialScore(supabase: any, candidateId: string, day: string): Promise<number> {
  const start = new Date(day);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 3); // janela de 72h

  const { data, error } = await supabase
    .from("social_interactions")
    .select("likes_count,shares_count,comments_count,replies_count,author_id,platform")
    .eq("candidate_id", candidateId)
    .gte("posted_at", start.toISOString())
    .lt("posted_at", end.toISOString())
    .limit(5000);
  if (error || !data) return 0;

  const allowed = new Set(["x","twitter","youtube","telegram","reddit","bluesky"]);
  const filtered = data.filter((r: any) => allowed.has((r.platform || "").toLowerCase()));
  if (filtered.length === 0) return 0;

  let engagement = 0;
  const authors = new Set<string>();
  for (const r of filtered) {
    engagement += (r.likes_count || 0) + (r.shares_count || 0) + (r.comments_count || 0) + (r.replies_count || 0);
    if (r.author_id) authors.add(r.author_id);
  }
  const score = Math.log10(engagement + 1) * 15 + Math.log10(authors.size + 1) * 10;
  return Math.min(100, Math.round(score));
}

function computeImportance(opts: {
  sourceCount: number;
  institutionalCount: number;
  socialScore: number;
  aiSignal: number;
}): number {
  const sourceScore = Math.min(100, opts.sourceCount * 8);
  const institutionalScore = Math.min(100, opts.institutionalCount * 25);
  const entityWeight = opts.aiSignal;
  const importance =
    0.35 * sourceScore +
    0.30 * institutionalScore +
    0.20 * opts.socialScore +
    0.15 * entityWeight;
  return Math.round(Math.min(100, importance));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const targetCandidate: string | undefined = body?.candidate_id;
    const lookback: number = Math.max(1, Math.min(60, body?.lookback_days || DEFAULT_LOOKBACK_DAYS));

    let candQ = supabase.from("candidates").select("id,user_id,full_name").eq("status", "active");
    if (targetCandidate) candQ = candQ.eq("id", targetCandidate);
    const { data: candidates, error: candErr } = await candQ.limit(50);
    if (candErr) throw candErr;

    let totalInserted = 0;
    const perCandidate: Record<string, number> = {};

    for (const c of candidates ?? []) {
      const items = await fetchGoogleNews(c.full_name, lookback);
      if (items.length === 0) { perCandidate[c.full_name] = 0; continue; }

      const clusters = clusterByDay(items);
      let inserted = 0;

      for (const [key, group] of clusters) {
        if (group.length < 2) continue; // exige pelo menos 2 fontes para virar evento
        const day = key.split("::")[0];
        const uniqByDomain = new Map<string, NewsItem>();
        for (const it of group) if (!uniqByDomain.has(it.domain)) uniqByDomain.set(it.domain, it);
        const uniqueSources = [...uniqByDomain.values()];
        if (uniqueSources.length < 2) continue;

        const headlines = uniqueSources.map((u) => `${u.title} (${u.domain})`);
        const cls = await classifyCluster(headlines, c.full_name);
        if (!cls || !cls.is_relevant) continue;

        const institutionalCount = uniqueSources.filter((u) =>
          INSTITUTIONAL_DOMAINS.some((id) => u.domain.endsWith(id))
        ).length;

        const socialScore = await calcSocialScore(supabase, c.id, day);
        const importance = computeImportance({
          sourceCount: uniqueSources.length,
          institutionalCount,
          socialScore,
          aiSignal: cls.importance_signal,
        });

        const sourcesJson = uniqueSources.map((u) => {
          const { type } = classifyDomain(u.url);
          return {
            source_name: u.source_name,
            url: u.url,
            type,
            published_at: u.published_at,
          };
        });

        // upsert por (candidate_id, event_date::date, title_canonical-ish key)
        const eventDate = new Date(day).toISOString();
        const { data: existing } = await supabase
          .from("political_events")
          .select("id")
          .eq("candidate_id", c.id)
          .eq("user_id", c.user_id)
          .gte("event_date", `${day}T00:00:00Z`)
          .lt("event_date", `${day}T23:59:59Z`)
          .ilike("title", `%${cls.title.slice(0, 40)}%`)
          .limit(1)
          .maybeSingle();

        const payload: Record<string, unknown> = {
          candidate_id: c.id,
          user_id: c.user_id,
          title: cls.title,
          event_name: cls.title,
          summary: cls.summary,
          ai_summary: cls.summary,
          category: cls.category,
          category_v2: cls.category,
          event_date: eventDate,
          event_type: "noticia",
          source_count: uniqueSources.length,
          total_sources: uniqueSources.length,
          institutional_sources: institutionalCount,
          social_score: socialScore,
          importance,
          importance_score: importance,
          status: "active",
          sources_json: sourcesJson,
          detection_source: "radar-pipeline",
          updated_at: new Date().toISOString(),
        };

        if (existing?.id) {
          await supabase.from("political_events").update(payload).eq("id", existing.id);
        } else {
          const { data: created } = await supabase
            .from("political_events")
            .insert(payload)
            .select("id")
            .single();
          if (created?.id) {
            const sourceRows = uniqueSources.map((u) => {
              const { type } = classifyDomain(u.url);
              return {
                event_id: created.id,
                source_name: u.source_name,
                source_type: type === "institutional" ? "institutional" : "news",
                url: u.url,
                title: u.title,
                published_at: u.published_at,
                is_institutional: type === "institutional",
                is_major_media: MAJOR_NEWS_DOMAINS.some((d) => u.domain.endsWith(d)),
                credibility_score: type === "institutional" ? 0.95 : 0.7,
              };
            });
            await supabase.from("event_sources").upsert(sourceRows, { onConflict: "event_id,url" });
            inserted++;
            totalInserted++;
          }
        }
      }

      perCandidate[c.full_name] = inserted;
    }

    return new Response(
      JSON.stringify({ ok: true, totalInserted, perCandidate }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[run-radar-pipeline] error", e);
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
