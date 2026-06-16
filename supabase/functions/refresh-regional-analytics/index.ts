// Pre-aggregates regional analytics per candidate into regional_analytics_cache.
// Runs server-side with the service role so the dashboard can read instantly.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, handleOptions, jsonResponse } from "../_shared/cors.ts";
import { inferLocation, CITY_TO_UF, UF_SET } from "../_shared/infer-location.ts";
import { getOutletInfo } from "../_shared/outlet-regions.ts";

const UF_TO_REGION: Record<string, string> = {
  AC: "Norte", AM: "Norte", AP: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste",
  PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const EXCLUDED_NETWORKS = new Set(["mastodon", "lemmy", "pinterest"]);
const PAGE = 1000;
const MAX_ROWS = 250_000;

interface Row {
  social_network: string | null;
  sentiment_label: string | null;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  state: string | null;
  region: string | null;
  comment_text: string | null;
  comment_author: string | null;
  author_profile_url: string | null;
  post_title: string | null;
  post_url: string | null;
  hashtags: string[] | null;
  created_at: string;
}

interface Agg {
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  engagement: number;
  networks: Map<string, number>;
}

function emptyAgg(): Agg {
  return { mentions: 0, positive: 0, negative: 0, neutral: 0, engagement: 0, networks: new Map() };
}

function classify(s: string | null): "positive" | "negative" | "neutral" {
  const k = (s || "").toLowerCase();
  if (k === "positive" || k === "positivo") return "positive";
  if (k === "negative" || k === "negativo") return "negative";
  return "neutral";
}

function hostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
}

function inferUFFromHashtags(tags: string[] | null): string | null {
  if (!tags || tags.length === 0) return null;
  for (const raw of tags) {
    const t = String(raw || "").toLowerCase().replace(/^#/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!t) continue;
    if (t.length === 2 && UF_SET.has(t.toUpperCase())) return t.toUpperCase();
    if (CITY_TO_UF[t]) return CITY_TO_UF[t];
    // tenta separar "saopaulo" → "sao paulo"
    for (const [city, uf] of Object.entries(CITY_TO_UF)) {
      if (t === city.replace(/\s+/g, "")) return uf;
    }
  }
  return null;
}

function inferUF(row: Row): { uf: string | null; region: string | null } {
  // 1) explicit state on row wins
  if (row.state && UF_SET.has(row.state)) {
    return { uf: row.state, region: row.region || UF_TO_REGION[row.state] || null };
  }
  // 2) heuristic from text (comment, author, profile, post title)
  const loc = inferLocation(row.comment_text, row.comment_author, row.author_profile_url, row.post_title);
  if (loc.state) return { uf: loc.state, region: loc.region };
  // 3) hashtags
  const hUf = inferUFFromHashtags(row.hashtags);
  if (hUf) return { uf: hUf, region: UF_TO_REGION[hUf] || null };
  // 4) regional media outlet via post URL host
  const host = hostFromUrl(row.post_url);
  if (host) {
    const outlet = getOutletInfo(host);
    if (outlet && outlet.region !== "Nacional" && outlet.region !== "Internacional") {
      return { uf: null, region: outlet.region as string };
    }
  }
  return { uf: null, region: null };
}

async function refreshCandidate(supabase: any, userId: string, candidateId: string) {
  const byRegion: Record<string, Agg> = {};
  const byState: Record<string, Agg> = {};

  let from = 0;
  let total = 0;
  // paginate
  while (from < MAX_ROWS) {
    const { data, error } = await supabase
      .from("social_interactions")
      .select(
        "social_network, sentiment_label, likes_count, replies_count, shares_count, state, region, comment_text, comment_author, author_profile_url, post_title, post_url, hashtags, created_at",
      )
      .eq("user_id", userId)
      .eq("candidate_id", candidateId)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data || []) as Row[];
    if (rows.length === 0) break;

    for (const r of rows) {
      const net = (r.social_network || "").toLowerCase();
      if (EXCLUDED_NETWORKS.has(net)) continue;

      const { uf, region } = inferUF(r);
      const sentiment = classify(r.sentiment_label);
      const eng = (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);

      const apply = (a: Agg) => {
        a.mentions++;
        a[sentiment]++;
        a.engagement += eng;
        if (net) a.networks.set(net, (a.networks.get(net) || 0) + 1);
      };

      if (region) {
        byRegion[region] = byRegion[region] || emptyAgg();
        apply(byRegion[region]);
      }
      if (uf) {
        byState[uf] = byState[uf] || emptyAgg();
        apply(byState[uf]);
      }
    }

    total += rows.length;
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  const now = new Date().toISOString();
  const aggToRow = (scope: "region" | "state", key: string, a: Agg) => ({
    user_id: userId,
    candidate_id: candidateId,
    scope,
    region: scope === "region" ? key : UF_TO_REGION[key] || null,
    state: scope === "state" ? key : null,
    mentions: a.mentions,
    positive: a.positive,
    negative: a.negative,
    neutral: a.neutral,
    avg_engagement: a.mentions ? Math.round((a.engagement / a.mentions) * 10) / 10 : 0,
    network_distribution: Array.from(a.networks.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((x, y) => y.count - x.count),
    last_refreshed_at: now,
    updated_at: now,
  });

  const upserts = [
    ...Object.entries(byRegion).map(([k, a]) => aggToRow("region", k, a)),
    ...Object.entries(byState).map(([k, a]) => aggToRow("state", k, a)),
  ];

  // Wipe stale rows for this candidate (so removed regions/states don't linger)
  await supabase.from("regional_analytics_cache").delete()
    .eq("user_id", userId).eq("candidate_id", candidateId);

  if (upserts.length > 0) {
    // chunked insert
    for (let i = 0; i < upserts.length; i += 200) {
      const chunk = upserts.slice(i, i + 200);
      const { error } = await supabase.from("regional_analytics_cache").insert(chunk);
      if (error) throw error;
    }
  }

  return { processed_rows: total, cache_rows: upserts.length };
}

Deno.serve(async (req) => {
  const opt = handleOptions(req);
  if (opt) return opt;

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const candidateId: string | undefined = body?.candidate_id;
    const userId: string | undefined = body?.user_id;

    // Build candidate list
    let candidates: { id: string; user_id: string }[] = [];
    if (candidateId) {
      const { data, error } = await supabase
        .from("candidates").select("id, user_id").eq("id", candidateId).limit(1);
      if (error) throw error;
      candidates = data || [];
    } else if (userId) {
      const { data, error } = await supabase
        .from("candidates").select("id, user_id").eq("user_id", userId).eq("status", "active");
      if (error) throw error;
      candidates = data || [];
    } else {
      const { data, error } = await supabase
        .from("candidates").select("id, user_id").eq("status", "active");
      if (error) throw error;
      candidates = data || [];
    }

    const results: any[] = [];
    for (const c of candidates) {
      try {
        const r = await refreshCandidate(supabase, c.user_id, c.id);
        results.push({ candidate_id: c.id, ...r });
      } catch (err) {
        console.error("[refresh-regional-analytics] candidate failed", c.id, err);
        results.push({ candidate_id: c.id, error: String(err) });
      }
    }

    return jsonResponse({ ok: true, count: results.length, results });
  } catch (e) {
    console.error("[refresh-regional-analytics] fatal", e);
    return jsonResponse({ ok: false, error: String(e) }, 500);
  }
});
