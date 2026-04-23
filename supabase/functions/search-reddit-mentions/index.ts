// Edge function: coleta manual de menções do Reddit para 1 candidato.
// Usa RSS-Bridge (mesma estratégia do reddit-cron-scraper) para evitar HTTP 403
// que o Reddit retorna em IPs de cloud (Supabase Functions).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RSS_BRIDGE_INSTANCES = [
  "https://rss-bridge.org/bridge01",
  "https://bridge.sysadmins.ws",
  "https://rssbridge.pw",
  "https://rss.nixnet.services",
];

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function stripHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticMatch(text: string, fullName: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) {
    return t.includes(`${parts[0]} ${parts[parts.length - 1]}`) ||
      t.includes(norm(fullName));
  }
  return t.includes(parts[0]);
}

function parseRssItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const pick = (tag: string): string => {
      const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
      const r = block.match(re);
      return r ? stripHtml(r[1]) : "";
    };
    items.push({
      title: pick("title"),
      link: pick("link"),
      description: pick("description"),
      author: pick("author") || pick("dc:creator"),
      pubDate: pick("pubDate") || pick("published") || pick("updated"),
    });
  }
  return items;
}

// Extrai o ID do post Reddit a partir da URL (ex: /r/sub/comments/abc123/titulo/)
function extractRedditPostId(url: string): string | null {
  const m = url.match(/\/comments\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

// Coleta comentários de um post via JSON público do Reddit
// Endpoint: https://www.reddit.com/comments/<id>.json
interface RedditComment {
  text: string;
  author: string;
  permalink: string;
  created: string;
  score: number;
}

async function fetchRedditComments(postUrl: string, postId: string): Promise<RedditComment[]> {
  // Reddit retorna 403 para Supabase Edge IPs no domínio principal,
  // mas .json funciona melhor com User-Agent realista. Tentamos antigos espelhos também.
  const endpoints = [
    `https://www.reddit.com/comments/${postId}.json?limit=100&depth=2`,
    `https://old.reddit.com/comments/${postId}.json?limit=100&depth=2`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[Reddit-Replies] ${url}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      // data[1] = comments listing
      const listing = Array.isArray(data) ? data[1]?.data?.children : null;
      if (!Array.isArray(listing)) continue;
      const out: RedditComment[] = [];
      const walk = (children: any[]) => {
        for (const ch of children) {
          if (ch.kind !== "t1") continue;
          const d = ch.data;
          if (!d?.body || d.body === "[deleted]" || d.body === "[removed]") continue;
          out.push({
            text: stripHtml(d.body).slice(0, 4000),
            author: d.author || "anônimo",
            permalink: `https://reddit.com${d.permalink || ""}`,
            created: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
            score: d.score || 0,
          });
          if (d.replies?.data?.children) walk(d.replies.data.children);
        }
      };
      walk(listing);
      if (out.length > 0) {
        console.log(`[Reddit-Replies] ${postId}: ${out.length} comentários`);
        return out;
      }
    } catch (e) {
      console.warn(`[Reddit-Replies] ${url} falhou: ${(e as Error).message}`);
    }
  }
  return [];
}

// Estratégia primária: PullPush.io (espelho público do Reddit/Pushshift, sem bloqueio cloud).
// Endpoints: /reddit/search/submission e /reddit/search/comment
async function fetchViaPullPush(query: string, limit: number): Promise<Array<Record<string, string>>> {
  const out: Array<Record<string, string>> = [];
  const endpoints = [
    `https://api.pullpush.io/reddit/search/submission?q=${encodeURIComponent(query)}&size=${Math.min(limit, 100)}&sort=desc&sort_type=created_utc`,
    `https://api.pullpush.io/reddit/search/comment?q=${encodeURIComponent(query)}&size=${Math.min(limit, 100)}&sort=desc&sort_type=created_utc`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": randomUA(), "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.warn(`[Reddit-PullPush] ${url.split("?")[0]}: HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const data = Array.isArray(json?.data) ? json.data : [];
      for (const d of data) {
        const isComment = typeof d.body === "string";
        const text = isComment ? d.body : (d.selftext || d.title || "");
        if (!text) continue;
        out.push({
          title: d.title || (isComment ? `Comentário em r/${d.subreddit || "?"}` : ""),
          link: d.permalink ? (d.permalink.startsWith("http") ? d.permalink : `https://reddit.com${d.permalink}`) : (d.url || ""),
          description: stripHtml(text).slice(0, 4000),
          author: d.author ? `u/${d.author}` : "Reddit user",
          pubDate: d.created_utc ? new Date(d.created_utc * 1000).toUTCString() : new Date().toUTCString(),
        });
      }
    } catch (e) {
      console.warn(`[Reddit-PullPush] erro: ${(e as Error).message}`);
    }
  }
  console.log(`[Reddit-PullPush] ${out.length} itens para "${query}"`);
  return out;
}

// Fallback secundário: JSON público do Reddit (frequentemente bloqueado por IP cloud)
async function fetchViaRedditJson(query: string, limit: number): Promise<Array<Record<string, string>>> {
  const endpoints = [
    `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}&t=month`,
    `https://old.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}&t=month`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": randomUA(), "Accept": "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) { console.warn(`[Reddit] ${url}: HTTP ${res.status}`); continue; }
      const data = await res.json();
      const children = data?.data?.children || [];
      if (children.length === 0) continue;
      const items = children.map((c: any) => {
        const d = c.data || {};
        return {
          title: d.title || "",
          link: `https://reddit.com${d.permalink || ""}`,
          description: d.selftext ? stripHtml(d.selftext).slice(0, 4000) : (d.title || ""),
          author: d.author ? `u/${d.author}` : "Reddit user",
          pubDate: d.created_utc ? new Date(d.created_utc * 1000).toUTCString() : new Date().toUTCString(),
        };
      });
      console.log(`[Reddit] reddit.json: ${items.length} itens para "${query}"`);
      return items;
    } catch (e) {
      console.warn(`[Reddit] ${url} falhou: ${(e as Error).message}`);
    }
  }
  return [];
}

async function fetchViaRssBridge(query: string): Promise<Array<Record<string, string>>> {
  for (const instance of RSS_BRIDGE_INSTANCES) {
    const url =
      `${instance}/?action=display&bridge=RedditBridge&context=Search+query&q=${encodeURIComponent(query)}&format=Mrss`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        console.warn(`[Reddit] ${instance}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[Reddit] ${instance}: ${items.length} itens para "${query}"`);
        return items;
      }
      console.warn(`[Reddit] ${instance}: 0 itens para "${query}"`);
    } catch (e) {
      console.warn(`[Reddit] ${instance} falhou: ${(e as Error).message}`);
    }
  }
  return [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    const { candidateName, candidateId, limit = 50 } = await req.json();

    if (!candidateName || !candidateId) {
      return new Response(
        JSON.stringify({ error: "candidateName e candidateId são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: candidate, error: candErr } = await supabase
      .from("candidates")
      .select("user_id")
      .eq("id", candidateId)
      .single();
    if (candErr || !candidate) {
      return new Response(
        JSON.stringify({ error: "Candidato não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = candidate.user_id as string;

    console.log(`[Reddit] Buscando menções via RSS-Bridge: ${candidateName}`);

    // === Background job ===
    const backgroundJob = (async () => {
     try {
    // Cascata: PullPush → Reddit JSON → RSS-Bridge
    let finalItems = await fetchViaPullPush(`"${candidateName}"`, limit);
    if (finalItems.length === 0) finalItems = await fetchViaRedditJson(`"${candidateName}"`, limit);
    if (finalItems.length === 0) finalItems = await fetchViaRssBridge(`"${candidateName}"`);

    if (finalItems.length === 0) {
      console.log('[Reddit-BG] nenhum item retornado');
      return;
    }

    const rows: any[] = [];
    let skipped = 0;
    for (const it of finalItems.slice(0, limit)) {
      const content = `${it.title}\n${it.description}`.slice(0, 4000).trim();
      const link = it.link;
      const author = it.author || "Reddit user";
      const created = it.pubDate
        ? new Date(it.pubDate).toISOString()
        : new Date().toISOString();

      if (!link || !content) { skipped++; continue; }
      if (!semanticMatch(content, candidateName)) { skipped++; continue; }

      rows.push({
        user_id: userId,
        candidate_id: candidateId,
        social_network: "Reddit",
        interaction_type: "post",
        comment_text: content,
        comment_author: author,
        author_profile_url: link,
        original_posted_at: created,
        collected_at: new Date().toISOString(),
        likes_count: 0,
        replies_count: 0,
        shares_count: 0,
      });
    }

    if (rows.length === 0) {
      console.log('[Reddit-BG] 0 rows após filtro semântico');
      return;
    }

    // Dedup por author_profile_url (URL do post)
    const urls = rows.map((r) => r.author_profile_url);
    const { data: existing } = await supabase
      .from("social_interactions")
      .select("author_profile_url")
      .eq("candidate_id", candidateId)
      .eq("social_network", "Reddit")
      .in("author_profile_url", urls);
    const existingSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
    const fresh = rows.filter((r) => !existingSet.has(r.author_profile_url));

    let inserted = 0;
    if (fresh.length > 0) {
      const { error: insertError } = await supabase
        .from("social_interactions")
        .insert(fresh);
      if (insertError) {
        console.error("[Reddit] insert falhou:", insertError.message);
      } else {
        inserted = fresh.length;
        console.log(`[Reddit] ${candidateName}: ${inserted} novos posts inseridos`);
      }
    }

    // ========= COLETA DE COMENTÁRIOS dos posts inseridos/encontrados =========
    let repliesInserted = 0;
    const postsForReplies = rows.slice(0, Math.min(rows.length, 30)); // até 30 posts por execução
    if (postsForReplies.length > 0) {
      const allReplies: any[] = [];
      const replyResults = await Promise.all(
        postsForReplies.map(async (p) => {
          const postId = extractRedditPostId(p.author_profile_url);
          if (!postId) return [];
          return fetchRedditComments(p.author_profile_url, postId);
        }),
      );
      for (let i = 0; i < postsForReplies.length; i++) {
        const parent = postsForReplies[i];
        for (const r of replyResults[i]) {
          allReplies.push({
            user_id: userId,
            candidate_id: candidateId,
            social_network: "Reddit",
            interaction_type: "reply",
            comment_text: r.text,
            comment_author: `u/${r.author}`,
            author_profile_url: r.permalink,
            original_posted_at: r.created,
            collected_at: new Date().toISOString(),
            likes_count: r.score,
            replies_count: 0,
            shares_count: 0,
          });
        }
      }
      if (allReplies.length > 0) {
        const replyUrls = allReplies.map((r) => r.author_profile_url);
        const { data: existingReplies } = await supabase
          .from("social_interactions")
          .select("author_profile_url")
          .eq("candidate_id", candidateId)
          .eq("social_network", "Reddit")
          .eq("interaction_type", "reply")
          .in("author_profile_url", replyUrls);
        const exSet = new Set((existingReplies ?? []).map((e: any) => e.author_profile_url));
        const freshReplies = allReplies.filter((r) => !exSet.has(r.author_profile_url));
        if (freshReplies.length > 0) {
          const { error: repErr } = await supabase
            .from("social_interactions")
            .insert(freshReplies);
          if (repErr) {
            console.error("[Reddit-Replies] insert falhou:", repErr.message);
          } else {
            repliesInserted = freshReplies.length;
            console.log(`[Reddit-Replies] ${candidateName}: ${repliesInserted} comentários inseridos`);
          }
        }
      }
    }

    console.log(`[Reddit-BG] complete: inserted=${inserted} replies=${repliesInserted} skipped=${skipped}`);
     } catch (bgErr) {
       console.error('[Reddit-BG] erro:', bgErr);
     }
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob);
    }

    return new Response(
      JSON.stringify({ success: true, accepted: true, message: 'Coleta Reddit iniciada em background' }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[Reddit] Exception:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
