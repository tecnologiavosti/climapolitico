// Edge function: coleta no Fediverso (Mastodon) sem auth, em múltiplas instâncias BR/PT.
// Usa endpoint público /api/v2/search com type=statuses (algumas instâncias exigem auth p/ statuses;
// caímos para /api/v1/timelines/tag/<hashtag> que é público em quase todas).
//
// Cada toot vira social_interactions(social_network='mastodon').

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UA = "ClimaPolitico/1.0 (+lovable)";

// Instâncias públicas com forte presença BR/PT
const INSTANCES = [
  "https://mastodon.social",
  "https://bolha.us",
  "https://ursal.zone",
  "https://masto.donte.com.br",
  "https://mastodon.com.br",
  "https://mstdn.social",
  "https://hachyderm.io",
  "https://infosec.exchange",
];

interface Toot {
  id: string;
  url: string;
  text: string;
  author: string;
  authorUrl: string;
  postedAt: string;
  likes: number;
  replies: number;
  shares: number;
}

function stripHtml(s: string): string {
  return (s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .trim();
}

async function searchTag(instance: string, tag: string): Promise<Toot[]> {
  const url = `${instance}/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const arr = await r.json();
    if (!Array.isArray(arr)) return [];
    return arr.map((t: any) => ({
      id: t.id,
      url: t.url || t.uri,
      text: stripHtml(t.content || ""),
      author: t.account?.acct || t.account?.username || "anon",
      authorUrl: t.account?.url || "",
      postedAt: t.created_at || new Date().toISOString(),
      likes: t.favourites_count || 0,
      replies: t.replies_count || 0,
      shares: t.reblogs_count || 0,
    }));
  } catch {
    return [];
  }
}

async function searchStatuses(instance: string, q: string): Promise<Toot[]> {
  // Sem auth; nem todas instâncias permitem, mas tentamos
  const url = `${instance}/api/v2/search?q=${encodeURIComponent(q)}&type=statuses&limit=20&resolve=false`;
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const arr = j?.statuses || [];
    return arr.map((t: any) => ({
      id: t.id,
      url: t.url || t.uri,
      text: stripHtml(t.content || ""),
      author: t.account?.acct || t.account?.username || "anon",
      authorUrl: t.account?.url || "",
      postedAt: t.created_at || new Date().toISOString(),
      likes: t.favourites_count || 0,
      replies: t.replies_count || 0,
      shares: t.reblogs_count || 0,
    }));
  } catch {
    return [];
  }
}

function nameMatches(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) || t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

function buildHashtags(name: string): string[] {
  const slug = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9 ]/g, "").trim();
  const parts = slug.split(/\s+/);
  const tags = new Set<string>();
  if (parts.length >= 2) {
    tags.add((parts[0] + parts[parts.length - 1]).toLowerCase());
    tags.add(parts.join("").toLowerCase());
  }
  tags.add(parts[0].toLowerCase());
  return Array.from(tags).filter((t) => t.length >= 4 && t.length <= 30);
}

async function collectForCandidate(fullName: string): Promise<Toot[]> {
  const all = new Map<string, Toot>();
  const tags = buildHashtags(fullName);

  // 1) Hashtag timeline em todas instâncias
  for (const inst of INSTANCES) {
    for (const tag of tags) {
      const toots = await searchTag(inst, tag);
      for (const t of toots) if (t.url) all.set(t.url, t);
    }
    // 2) Search por nome completo (algumas instâncias permitem)
    const found = await searchStatuses(inst, fullName);
    for (const t of found) if (t.url && nameMatches(t.text, fullName)) all.set(t.url, t);
  }

  return Array.from(all.values()).filter((t) => t.text && nameMatches(t.text, fullName));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body.candidateId as string | undefined;

    let candidates: Array<{ id: string; full_name: string; user_id: string }> = [];
    if (targetId) {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("id", targetId).maybeSingle();
      if (data) candidates = [data as any];
    } else {
      const { data } = await supabase.from("candidates")
        .select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = (data || []) as any[];
    }

    let totalInserted = 0;
    let totalCollected = 0;
    const details: Array<{ name: string; collected: number; inserted: number }> = [];

    for (const c of candidates) {
      const toots = await collectForCandidate(c.full_name);
      totalCollected += toots.length;
      let inserted = 0;
      for (const t of toots) {
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("id")
          .eq("candidate_id", c.id)
          .eq("social_network", "mastodon")
          .eq("author_profile_url", t.url)
          .maybeSingle();
        if (existing) continue;

        const { error } = await supabase.from("social_interactions").insert({
          user_id: c.user_id,
          candidate_id: c.id,
          social_network: "mastodon",
          interaction_type: "post",
          comment_text: t.text.slice(0, 4000),
          comment_author: t.author,
          author_profile_url: t.url,
          sentiment_label: null,
          sentiment_score: null,
          likes_count: t.likes,
          replies_count: t.replies,
          shares_count: t.shares,
          collected_at: new Date().toISOString(),
          original_posted_at: t.postedAt,
        });
        if (!error) inserted++;
      }
      totalInserted += inserted;
      details.push({ name: c.full_name, collected: toots.length, inserted });
      await new Promise((r) => setTimeout(r, 600));
    }

    try {
      await supabase.rpc("record_collector_call", {
        _name: "mastodon", _items: totalInserted, _had_error: false,
      });
    } catch (_) {}

    return new Response(JSON.stringify({
      success: true,
      candidates_processed: candidates.length,
      total_collected: totalCollected,
      total_inserted: totalInserted,
      details,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[MASTODON] erro:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
