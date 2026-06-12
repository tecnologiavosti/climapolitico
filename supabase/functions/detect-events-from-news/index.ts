// detect-events-from-news
// ============================================================================
// STEP 2 da refatoração enterprise da aba "Picos de Menções".
//
// Filosofia: EVENT-FIRST. Eventos NASCEM de notícias/institucional, nunca de
// spike social. Esta função:
//   1) Lê source_registry (RSS ativos: institucionais + grande imprensa)
//   2) Coleta últimos itens de cada feed em paralelo (com timeout)
//   3) Casa cada item contra os candidatos do escopo (full_name + apelidos)
//   4) Cria/atualiza public.political_events (1 evento por candidato+dia+headline)
//      com detection_source='news' e popula public.event_sources
//   5) Atualiza contadores total_sources / institutional_sources / major_media_sources
//
// O clustering semântico fica para o STEP 3 (cluster-political-events).
// A validação confirmed/probable/weak/noise fica para o STEP 4 (validate-event).
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS_PER_FEED = 60;
const DEFAULT_MAX_AGE_HOURS = 72;
const UA =
  "Mozilla/5.0 (compatible; ClimaPoliticoBot/1.0; +https://climapolitico.com.br)";

// --------------------------------------------------------------------------
// Utilidades
// --------------------------------------------------------------------------
function stripTags(s: string): string {
  return (s || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchWithTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    return r;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Parser RSS/Atom minimalista — sem dependências externas
interface FeedItem {
  title: string;
  link: string;
  description: string;
  publishedAt: string | null;
}

function parseFeed(xml: string): FeedItem[] {
  if (!xml || xml.length < 50) return [];
  const items: FeedItem[] = [];

  // RSS <item>
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  // Atom <entry>
  const entryRe = /<entry\b[\s\S]*?<\/entry>/gi;
  const blocks = (xml.match(itemRe) || []).concat(xml.match(entryRe) || []);

  for (const block of blocks.slice(0, MAX_ITEMS_PER_FEED)) {
    const title = stripTags(
      (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim(),
    );
    let link = "";
    const linkRss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1];
    if (linkRss && !/^\s*$/.test(linkRss)) link = stripTags(linkRss);
    if (!link) {
      const atomHref = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
      if (atomHref) link = atomHref;
    }
    const description = stripTags(
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ||
        block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] ||
        block.match(/<content[^>]*>([\s\S]*?)<\/content>/i)?.[1] ||
        "").slice(0, 1000),
    );
    const pub =
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ||
      block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i)?.[1] ||
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1] ||
      block.match(/<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i)?.[1];
    let publishedAt: string | null = null;
    if (pub) {
      const d = new Date(stripTags(pub));
      if (!isNaN(d.getTime())) publishedAt = d.toISOString();
    }
    if (title && link) items.push({ title, link, description, publishedAt });
  }
  return items;
}

// Gera apelidos simples para matching: nome completo e variações úteis.
function buildCandidateAliases(fullName: string): string[] {
  const norm = normalize(fullName);
  const parts = norm.split(" ").filter((p) => p.length >= 3);
  const aliases = new Set<string>();
  if (norm.length >= 4) aliases.add(norm);
  if (parts.length >= 2) {
    aliases.add(`${parts[0]} ${parts[parts.length - 1]}`);
    aliases.add(parts[parts.length - 1]);
  }
  if (parts[0]?.length >= 5) aliases.add(parts[0]);
  return [...aliases];
}

function matchCandidates(
  text: string,
  candidates: { id: string; user_id: string; full_name: string; aliases: string[] }[],
): { id: string; user_id: string; full_name: string }[] {
  const hay = ` ${normalize(text)} `;
  const out: { id: string; user_id: string; full_name: string }[] = [];
  for (const c of candidates) {
    for (const a of c.aliases) {
      if (a.length < 4) continue;
      if (hay.includes(` ${a} `)) {
        out.push({ id: c.id, user_id: c.user_id, full_name: c.full_name });
        break;
      }
    }
  }
  return out;
}

function dayKey(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------
// Pipeline
// --------------------------------------------------------------------------
interface RunStats {
  feeds_total: number;
  feeds_ok: number;
  feeds_failed: number;
  items_parsed: number;
  matches: number;
  events_created: number;
  sources_inserted: number;
  candidates_scanned: number;
  errors: string[];
}

async function runPipeline(
  admin: ReturnType<typeof createClient>,
  opts: { user_id?: string | null; candidate_ids?: string[] | null; max_age_hours: number },
): Promise<RunStats> {
  const stats: RunStats = {
    feeds_total: 0, feeds_ok: 0, feeds_failed: 0,
    items_parsed: 0, matches: 0, events_created: 0, sources_inserted: 0,
    candidates_scanned: 0, errors: [],
  };

  // 1) Candidatos no escopo
  let q = admin.from("candidates").select("id, user_id, full_name").eq("status", "active");
  if (opts.user_id) q = q.eq("user_id", opts.user_id);
  if (opts.candidate_ids?.length) q = q.in("id", opts.candidate_ids);
  const { data: cands, error: candErr } = await q;
  if (candErr) { stats.errors.push(`candidates: ${candErr.message}`); return stats; }
  const candidates = (cands || []).map((c: any) => ({
    id: c.id as string,
    user_id: c.user_id as string,
    full_name: c.full_name as string,
    aliases: buildCandidateAliases(c.full_name),
  }));
  stats.candidates_scanned = candidates.length;
  if (candidates.length === 0) return stats;

  // 2) Fontes RSS ativas
  const { data: sources, error: srcErr } = await admin
    .from("source_registry")
    .select("source_name, source_type, source_domain, credibility_weight, rss_url")
    .eq("is_active", true)
    .not("rss_url", "is", null);
  if (srcErr) { stats.errors.push(`source_registry: ${srcErr.message}`); return stats; }
  const feeds = (sources || []).filter((s: any) => !!s.rss_url);
  stats.feeds_total = feeds.length;

  const minPublished = Date.now() - opts.max_age_hours * 3_600_000;

  // 3) Fetch paralelo limitado
  const concurrency = 6;
  const enriched: {
    source_name: string; source_type: string; credibility: number;
    item: FeedItem;
  }[] = [];

  async function processFeed(feed: any) {
    const r = await fetchWithTimeout(feed.rss_url);
    if (!r || !r.ok) { stats.feeds_failed++; return; }
    const xml = await r.text();
    const items = parseFeed(xml);
    if (!items.length) { stats.feeds_failed++; return; }
    stats.feeds_ok++;
    for (const it of items) {
      if (it.publishedAt && new Date(it.publishedAt).getTime() < minPublished) continue;
      enriched.push({
        source_name: feed.source_name,
        source_type: feed.source_type,
        credibility: Number(feed.credibility_weight) || 0.5,
        item: it,
      });
      stats.items_parsed++;
    }
  }

  for (let i = 0; i < feeds.length; i += concurrency) {
    await Promise.all(feeds.slice(i, i + concurrency).map(processFeed));
  }

  // 4) Matching contra candidatos
  type Hit = {
    candidate_id: string;
    user_id: string;
    candidate_name: string;
    title: string;
    url: string;
    snippet: string;
    publishedAt: string | null;
    source_name: string;
    source_type: string;
    credibility: number;
    day: string;
  };

  const hits: Hit[] = [];
  for (const e of enriched) {
    const text = `${e.item.title} ${e.item.description}`;
    const matches = matchCandidates(text, candidates);
    for (const m of matches) {
      hits.push({
        candidate_id: m.id,
        user_id: m.user_id,
        candidate_name: m.full_name,
        title: e.item.title.slice(0, 500),
        url: e.item.link,
        snippet: e.item.description.slice(0, 800),
        publishedAt: e.item.publishedAt,
        source_name: e.source_name,
        source_type: e.source_type,
        credibility: e.credibility,
        day: dayKey(e.item.publishedAt),
      });
      stats.matches++;
    }
  }
  if (hits.length === 0) return stats;

  // 5) Agrupar por (candidate_id, day, normalized_title) -> 1 evento candidato
  //    Headline canônica = primeira ocorrência. Fontes = todos os hits dessa chave.
  const groups = new Map<string, { rep: Hit; sources: Hit[] }>();
  for (const h of hits) {
    const tnorm = normalize(h.title).split(" ").slice(0, 8).join(" ");
    const key = `${h.candidate_id}|${h.day}|${tnorm}`;
    if (!groups.has(key)) groups.set(key, { rep: h, sources: [] });
    groups.get(key)!.sources.push(h);
  }

  // 6) Inserir eventos + fontes
  for (const { rep, sources: src } of groups.values()) {
    const peakIso = rep.publishedAt || `${rep.day}T12:00:00Z`;

    // Tenta achar evento já existente nesse dia/candidato/titulo canônico para idempotência
    const { data: existing } = await admin
      .from("political_events")
      .select("id, total_sources, institutional_sources, major_media_sources")
      .eq("user_id", rep.user_id)
      .eq("candidate_id", rep.candidate_id)
      .eq("title_canonical", rep.title.slice(0, 240))
      .gte("peak_date", `${rep.day}T00:00:00Z`)
      .lt("peak_date", `${rep.day}T23:59:59Z`)
      .maybeSingle();

    let eventId: string | null = existing?.id ?? null;

    if (!eventId) {
      const { data: ins, error: insErr } = await admin
        .from("political_events")
        .insert({
          user_id: rep.user_id,
          candidate_id: rep.candidate_id,
          event_name: rep.title.slice(0, 240),
          title_canonical: rep.title.slice(0, 240),
          event_type: "news",
          detection_source: "news",
          event_date: peakIso,
          peak_date: peakIso,
          start_date: peakIso,
          end_date: peakIso,
          description: rep.snippet || rep.title,
          is_social_only: false,
          keywords: [],
          metadata: { source: "detect-events-from-news", first_source: rep.source_name },
        })
        .select("id")
        .single();
      if (insErr) { stats.errors.push(`insert event: ${insErr.message}`); continue; }
      eventId = ins!.id as string;
      stats.events_created++;
    }

    // Inserir cada fonte (UPSERT por unique(event_id,url))
    const rows = src.map((s) => ({
      event_id: eventId,
      source_name: s.source_name,
      source_type: s.source_type,
      url: s.url,
      title: s.title,
      snippet: s.snippet,
      published_at: s.publishedAt,
      credibility_score: s.credibility,
      is_institutional: s.source_type === "institutional",
      is_major_media: s.source_type === "major_news",
    }));
    const { error: srcInsErr, count } = await admin
      .from("event_sources")
      .upsert(rows, { onConflict: "event_id,url", count: "exact", ignoreDuplicates: true });
    if (srcInsErr) { stats.errors.push(`upsert event_sources: ${srcInsErr.message}`); }
    else stats.sources_inserted += count ?? rows.length;

    // Recontagem total de fontes desse evento (mais simples e correto que somar)
    const { data: counts } = await admin
      .from("event_sources")
      .select("source_type", { count: "exact" })
      .eq("event_id", eventId);
    const all = counts || [];
    const total = all.length;
    const inst = all.filter((r: any) => r.source_type === "institutional").length;
    const major = all.filter((r: any) => r.source_type === "major_news").length;
    await admin
      .from("political_events")
      .update({
        total_sources: total,
        institutional_sources: inst,
        major_media_sources: major,
      })
      .eq("id", eventId);
  }

  return stats;
}

// --------------------------------------------------------------------------
// HTTP entrypoint
// --------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth: aceita service-role direta (cron) OU JWT de usuário (escopo automático para o user)
    const auth = req.headers.get("Authorization") || "";
    const isServiceRole = auth.includes(SERVICE_KEY);

    let userId: string | null = null;
    if (!isServiceRole) {
      if (!auth) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: auth } },
      });
      const { data: ud } = await userClient.auth.getUser();
      if (!ud?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = ud.user.id;
    }

    const body = await req.json().catch(() => ({}));
    const maxAge = Math.min(Math.max(Number(body?.max_age_hours) || DEFAULT_MAX_AGE_HOURS, 6), 24 * 14);
    const candidateIds: string[] | null = Array.isArray(body?.candidate_ids) ? body.candidate_ids : null;
    // Service role pode rodar pra todos OU pra um user_id específico
    const scopedUserId = isServiceRole ? (body?.user_id ?? null) : userId;

    const stats = await runPipeline(admin, {
      user_id: scopedUserId,
      candidate_ids: candidateIds,
      max_age_hours: maxAge,
    });

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("detect-events-from-news error", e);
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
