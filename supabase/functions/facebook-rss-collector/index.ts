// Facebook RSS collector — fallback gratuito via RSS-Bridge para páginas públicas
// e via Google News (site:facebook.com) para menções indexadas. Não substitui Apify,
// roda em paralelo para aumentar volume. Salva em social_interactions.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { cleanContent } from "../_shared/clean-content.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RSSBRIDGE_INSTANCES = [
  "https://rss-bridge.org/bridge01",
  "https://rss.nixnet.services",
  "https://rssbridge.flossboxin.org.in",
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36";
const bridge = () => RSSBRIDGE_INSTANCES[Math.floor(Math.random() * RSSBRIDGE_INSTANCES.length)];

async function safeFetch(url: string, timeoutMs = 12000): Promise<Response | null> {
  const c = new AbortController();
  const id = setTimeout(() => c.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: c.signal });
    clearTimeout(id);
    return r;
  } catch { clearTimeout(id); return null; }
}

interface Item { title: string; link: string; description: string; pubDate: string; author?: string; image?: string | null; }

function parseRssXml(xml: string): Item[] {
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const x = m[1];
    const rawTitle = (x.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] ?? x.match(/<title>(.*?)<\/title>/)?.[1] ?? "");
    const title = cleanContent(rawTitle);
    const link = x.match(/<link>(.*?)<\/link>/)?.[1] ?? "";
    const rawDescription = (x.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s)?.[1] ?? x.match(/<description>(.*?)<\/description>/s)?.[1] ?? "");
    const description = cleanContent(rawDescription);
    const pubDate = x.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? "";
    const author = cleanContent(x.match(/<author>(.*?)<\/author>/)?.[1] ?? x.match(/<dc:creator><!\[CDATA\[(.*?)\]\]><\/dc:creator>/)?.[1] ?? "") || undefined;
    const image = x.match(/<media:content[^>]+url=["']([^"']+)["']/)?.[1]
      || x.match(/<enclosure[^>]+url=["']([^"']+)["']/)?.[1]
      || x.match(/<img[^>]+src=["']([^"']+)["']/)?.[1]
      || null;
    if (title && link) items.push({ title, link, description, pubDate, author, image });
  }
  return items;
}

async function fbViaGoogleNews(name: string): Promise<Item[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`site:facebook.com "${name}"`)}&hl=pt-BR&gl=BR&ceid=BR:pt`;
  const r = await safeFetch(url);
  if (!r || !r.ok) return [];
  return parseRssXml(await r.text());
}

async function fbViaBridge(pageHandle: string): Promise<Item[]> {
  const url = `${bridge()}/?action=display&bridge=Facebook&id=${encodeURIComponent(pageHandle)}&limit=30&format=Atom`;
  const r = await safeFetch(url);
  if (!r || !r.ok) return [];
  // RSS-Bridge Atom → entries; reaproveita parser tolerante
  return parseRssXml(await r.text());
}

function extractFbHandle(link?: string | null): string | null {
  if (!link) return null;
  const m = link.match(/facebook\.com\/([A-Za-z0-9.\-]+)/i);
  if (m && !["sharer", "dialog", "plugins", "watch", "groups"].includes(m[1].toLowerCase())) {
    return m[1].replace(/\/$/, "");
  }
  return null;
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
      const { data } = await supabase.from("candidates").select("id, full_name, user_id, social_media_link").eq("id", targetId).maybeSingle();
      if (data) candidates = [data];
    } else {
      const { data } = await supabase.from("candidates").select("id, full_name, user_id, social_media_link").eq("status", "active").limit(200);
      candidates = data || [];
    }

    let inserted = 0;
    for (const c of candidates) {
      // 1) busca Google News para menções de FB
      const newsItems = await fbViaGoogleNews(c.full_name);

      // 2) tenta página oficial do candidato se tiver link conhecido
      let pageItems: Item[] = [];
      const { data: links } = await supabase
        .from("candidate_social_links").select("url").eq("candidate_id", c.id).eq("platform", "facebook");
      const handles = new Set<string>();
      for (const l of links ?? []) {
        const h = extractFbHandle(l.url);
        if (h) handles.add(h);
      }
      const mainHandle = extractFbHandle(c.social_media_link);
      if (mainHandle) handles.add(mainHandle);
      for (const h of handles) {
        pageItems = pageItems.concat(await fbViaBridge(h));
      }

      const all = [...newsItems, ...pageItems];
      for (const it of all) {
        const text = (it.title + " " + it.description).trim().slice(0, 4000);
        if (!text || text.length < 20 || !it.link) continue;
        const { error } = await supabase.from("social_interactions").insert({
          user_id: c.user_id, candidate_id: c.id, social_network: "facebook",
          platform: "facebook",
          interaction_type: "post", comment_text: text,
          comment_author: it.author ?? "Facebook", author_profile_url: it.link,
          post_url: it.link,
          post_title: it.title,
          post_description: it.description || text,
          thumbnail_url: it.image,
          author_name: it.author ?? "Facebook",
          engagement_score: 1,
          sentiment_label: "Neutro", sentiment_score: 0.5,
          likes_count: 0, replies_count: 0, shares_count: 0,
          collected_at: new Date().toISOString(),
          original_posted_at: it.pubDate ? new Date(it.pubDate).toISOString() : null,
        });
        if (!error) inserted++;
      }
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
