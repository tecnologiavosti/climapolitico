// Pinterest collector — coleta pins via RSS nativo + fallback RSS-Bridge.
// Sem API key. Salva no schema real do projeto: social_interactions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { newPipelineRecorder } from "../_shared/pipeline-metrics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RSSBRIDGE_INSTANCES = [
  "https://rss-bridge.org/bridge01",
  "https://rss.nixnet.services",
  "https://rssbridge.flossboxin.org.in",
  "https://rss-bridge.giko.fr",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1",
];
const ua = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
const bridge = () => RSSBRIDGE_INSTANCES[Math.floor(Math.random() * RSSBRIDGE_INSTANCES.length)];

async function safeFetch(url: string, timeoutMs = 12000): Promise<Response | null> {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": ua() }, signal: c.signal });
    clearTimeout(id);
    return r;
  } catch {
    clearTimeout(id);
    return null;
  }
}

interface Item { title: string; link: string; description: string; pubDate: string; }

async function fetchPinterestRSS(term: string): Promise<Item[]> {
  const url = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(term)}.rss`;
  const r = await safeFetch(url);
  if (!r || !r.ok) return [];
  const xml = await r.text();
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const title = x.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ?? x.match(/<title>(.*?)<\/title>/)?.[1] ?? "";
    const link = x.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const description = (x.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1] ?? "").replace(/<[^>]+>/g, "");
    const pubDate = x.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    if (link) items.push({ title, link, description, pubDate });
  }
  return items;
}

async function fetchPinterestBridge(term: string): Promise<Item[]> {
  const url = `${bridge()}/?action=display&bridge=Pinterest&q=${encodeURIComponent(term)}&limit=50&format=Json`;
  const r = await safeFetch(url);
  if (!r || !r.ok) return [];
  try {
    const d = await r.json();
    return (d.items ?? []).map((i: any) => ({
      title: i.title ?? "",
      link: i.url ?? "",
      description: (i.content_text ?? "").slice(0, 1000),
      pubDate: i.date_modified ?? new Date().toISOString(),
    }));
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  try {
    const body = await req.json().catch(() => ({}));
    const targetId = body.candidateId as string | undefined;
    let candidates: any[] = [];
    if (targetId) {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("id", targetId).maybeSingle();
      if (data) candidates = [data];
    } else {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id").eq("status", "active").limit(200);
      candidates = data || [];
    }

    let inserted = 0;
    for (const c of candidates) {
      const rec = newPipelineRecorder("pinterest", c.id);
      const [a, b] = await Promise.all([fetchPinterestRSS(c.full_name), fetchPinterestBridge(c.full_name)]);
      rec.addCollected(a.length, "pinterest_rss");
      rec.addCollected(b.length, "rssbridge");
      const items = [...a, ...b];
      for (const it of items) {
        const text = `${it.title} ${it.description}`.trim().slice(0, 4000);
        if (!text || text.length < 15 || !it.link) { rec.addFiltered(1, "invalid_payload"); continue; }
        rec.addParsed(1);
        const { error } = await supabase.from("social_interactions").insert({
          user_id: c.user_id, candidate_id: c.id, social_network: "pinterest",
          interaction_type: "post", comment_text: text,
          comment_author: "Pinterest", author_profile_url: it.link,
          sentiment_label: "Neutro", sentiment_score: 0.5,
          likes_count: 0, replies_count: 0, shares_count: 0,
          collected_at: new Date().toISOString(),
          original_posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        });
        if (!error) { inserted++; rec.addInserted(1); }
        else if ((error as any).code === "23505") rec.addDeduped(1, "db");
        else rec.setError(error.message);
      }
      await rec.flush();
    }
    return new Response(JSON.stringify({ ok: true, inserted, candidates: candidates.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
