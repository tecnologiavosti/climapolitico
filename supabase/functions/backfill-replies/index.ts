// Edge function: backfill de COMENTÁRIOS sobre posts já existentes em
// `social_interactions` (Reddit, Twitter/X, Telegram). Não depende de
// novos posts: busca replies para os posts dos últimos N dias que ainda
// não têm replies coletadas.
//
// Body: { candidateId: string, days?: number, perNetworkLimit?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

function stripHtml(s: string): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[/g, "").replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

// ============= REDDIT =============
function extractRedditPostId(url: string): string | null {
  const m = url.match(/\/comments\/([a-z0-9]+)/i);
  return m ? m[1] : null;
}

async function fetchRedditComments(postId: string) {
  const endpoints = [
    `https://www.reddit.com/comments/${postId}.json?limit=100&depth=2`,
    `https://old.reddit.com/comments/${postId}.json?limit=100&depth=2`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": randomUA(), "Accept": "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const listing = Array.isArray(data) ? data[1]?.data?.children : null;
      if (!Array.isArray(listing)) continue;
      const out: any[] = [];
      const walk = (children: any[]) => {
        for (const ch of children) {
          if (ch.kind !== "t1") continue;
          const d = ch.data;
          if (!d?.body || d.body === "[deleted]" || d.body === "[removed]") continue;
          out.push({
            text: stripHtml(d.body).slice(0, 4000),
            author: `u/${d.author || "anônimo"}`,
            url: `https://reddit.com${d.permalink || ""}`,
            postedAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : new Date().toISOString(),
            likes: d.score || 0,
          });
          if (d.replies?.data?.children) walk(d.replies.data.children);
        }
      };
      walk(listing);
      if (out.length > 0) return out;
    } catch (_) { /* tenta próximo */ }
  }
  return [];
}

// ============= TWITTER / NITTER =============
function decodeHtml(s: string): string {
  return (s || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

function parseNitterReplies(html: string, host: string) {
  const out: any[] = [];
  const blocks = html.match(/<div class="timeline-item[^"]*"[\s\S]*?(?=<div class="timeline-item|<\/div>\s*<\/div>\s*<\/main>)/gi) || [];
  for (const block of blocks) {
    const userMatch = block.match(/class="username"[^>]*>@?([A-Za-z0-9_]{2,20})/);
    const textMatch = block.match(/class="tweet-content[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const dateMatch = block.match(/class="tweet-date"[^>]*>\s*<a[^>]*title="([^"]+)"[^>]*href="([^"]+)"/);
    const likesMatch = block.match(/class="icon-heart"[^>]*>\s*<\/span>\s*([\d,\.]+)/);
    if (!userMatch || !textMatch) continue;
    const text = decodeHtml(textMatch[1]);
    if (!text || text.length < 5) continue;
    let postedAt = new Date().toISOString();
    if (dateMatch) {
      const d = new Date(dateMatch[1]);
      if (!isNaN(d.getTime())) postedAt = d.toISOString();
    }
    const path = dateMatch?.[2] || "";
    const url = path ? (path.startsWith("http") ? path : `${host}${path}`) : null;
    const likes = likesMatch ? parseInt(likesMatch[1].replace(/[,.]/g, ""), 10) || 0 : 0;
    out.push({ text, author: `@${userMatch[1]}`, url, postedAt, likes });
  }
  return out;
}

async function fetchTweetReplies(tweetUrl: string, hosts: string[]) {
  const m = tweetUrl.match(/(?:x\.com|twitter\.com|xcancel\.com|nitter\.[^/]+)\/([A-Za-z0-9_]+\/status\/\d+)/);
  if (!m) return [];
  const path = `/${m[1]}`;
  for (const host of hosts) {
    try {
      const res = await fetch(`${host}${path}`, {
        headers: { "User-Agent": randomUA(), "Accept": "text/html" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
      const replies = parseNitterReplies(html, host);
      if (replies.length > 0) return replies;
    } catch (_) { /* tenta próximo */ }
  }
  return [];
}

// ============= TELEGRAM =============
function extractTelegramRef(url: string): { channel: string; msgId: string } | null {
  const m = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{4,32})\/(\d+)/i);
  return m ? { channel: m[1].toLowerCase(), msgId: m[2] } : null;
}

function parseTelegramReplies(html: string, channel: string, msgId: string) {
  const out: any[] = [];
  const msgRe = /<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div[^>]*class="[^"]*tgme_widget_message\b|<\/section)/gi;
  let m: RegExpExecArray | null;
  while ((m = msgRe.exec(html)) !== null) {
    const block = m[0];
    const postId = m[1];
    if (postId === `${channel}/${msgId}`) continue;
    const textMatch = block.match(/<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const text = textMatch ? stripHtml(textMatch[1]) : "";
    if (!text || text.length < 5) continue;
    const authorMatch = block.match(/class="[^"]*tgme_widget_message_author_name[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/class="[^"]*tgme_widget_message_owner_name[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/class="[^"]*tgme_widget_message_from_author[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const author = authorMatch ? stripHtml(authorMatch[1]) : "Telegram user";
    const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);
    const postedAt = dateMatch ? dateMatch[1] : new Date().toISOString();
    out.push({ text: text.slice(0, 4000), author, url: `https://t.me/${postId}`, postedAt, likes: 0 });
  }
  return out;
}

async function fetchTelegramReplies(channel: string, msgId: string) {
  try {
    const res = await fetch(`https://t.me/${channel}/${msgId}?embed=1&discussion=1&comments_limit=20&mode=tme`, {
      headers: { "User-Agent": randomUA(), "Accept": "text/html" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    if (!html.includes("tgme_widget_message")) return [];
    return parseTelegramReplies(html, channel, msgId);
  } catch (_) {
    return [];
  }
}

// ============= MAIN =============
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Validação JWT — aceita service role (cron) ou usuário autenticado
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = auth.replace("Bearer ", "");
    const isServiceRole = token === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    if (!isServiceRole) {
      const { data: userData, error: authErr } = await supabase.auth.getUser(token);
      if (authErr || !userData?.user) {
        return new Response(JSON.stringify({ error: "Token inválido" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const { candidateId, days = 7, perNetworkLimit = 30 } = await req.json();
    if (!candidateId) {
      return new Response(JSON.stringify({ error: "candidateId obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: candidate } = await supabase
      .from("candidates").select("user_id").eq("id", candidateId).single();
    if (!candidate) {
      return new Response(JSON.stringify({ error: "Candidato não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = candidate.user_id as string;
    const since = new Date(Date.now() - days * 86400_000).toISOString();

    // === Background job ===
    const backgroundJob = (async () => {
     try {
    // Carrega instâncias Nitter saudáveis (para Twitter)
    const { data: nitterRows } = await supabase
      .from("nitter_instances")
      .select("url")
      .eq("is_active", true)
      .order("last_error_at", { ascending: true, nullsFirst: true })
      .limit(8);
    const nitterHosts = (nitterRows || []).map((r: any) => r.url as string);
    if (nitterHosts.length === 0) {
      nitterHosts.push("https://xcancel.com", "https://nitter.privacydev.net");
    }

    const summary: Record<string, { processed: number; replies: number }> = {
      Reddit: { processed: 0, replies: 0 },
      "Twitter/X": { processed: 0, replies: 0 },
      Telegram: { processed: 0, replies: 0 },
    };

    for (const network of ["Reddit", "Twitter/X", "Telegram"]) {
      // Pega posts dos últimos N dias
      const { data: posts } = await supabase
        .from("social_interactions")
        .select("id, author_profile_url")
        .eq("candidate_id", candidateId)
        .eq("social_network", network)
        .eq("interaction_type", "post")
        .gte("collected_at", since)
        .not("author_profile_url", "is", null)
        .order("collected_at", { ascending: false })
        .limit(perNetworkLimit);

      if (!posts || posts.length === 0) continue;

      // Para cada post, busca replies
      const replyArrays = await Promise.all(
        posts.map(async (p: any) => {
          summary[network].processed++;
          const url = p.author_profile_url as string;
          if (network === "Reddit") {
            const id = extractRedditPostId(url);
            return id ? fetchRedditComments(id) : [];
          }
          if (network === "Twitter/X") {
            return fetchTweetReplies(url, nitterHosts);
          }
          if (network === "Telegram") {
            const ref = extractTelegramRef(url);
            return ref ? fetchTelegramReplies(ref.channel, ref.msgId) : [];
          }
          return [];
        }),
      );

      // Monta linhas
      const allReplies: any[] = [];
      for (const arr of replyArrays) {
        for (const r of arr) {
          if (!r.url) continue;
          allReplies.push({
            user_id: userId,
            candidate_id: candidateId,
            social_network: network,
            interaction_type: "reply",
            comment_text: r.text,
            comment_author: r.author,
            author_profile_url: r.url,
            original_posted_at: r.postedAt,
            collected_at: new Date().toISOString(),
            likes_count: r.likes || 0,
            replies_count: 0,
            shares_count: 0,
          });
        }
      }

      if (allReplies.length === 0) continue;

      // Dedup por URL
      const urls = allReplies.map((r) => r.author_profile_url);
      const { data: existing } = await supabase
        .from("social_interactions")
        .select("author_profile_url")
        .eq("candidate_id", candidateId)
        .eq("social_network", network)
        .eq("interaction_type", "reply")
        .in("author_profile_url", urls);
      const exSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
      const fresh = allReplies.filter((r) => !exSet.has(r.author_profile_url));

      if (fresh.length > 0) {
        const { error } = await supabase.from("social_interactions").insert(fresh);
        if (!error) {
          summary[network].replies = fresh.length;
          console.log(`[Backfill-${network}] ${fresh.length} replies inseridas`);
        } else {
          console.error(`[Backfill-${network}] insert falhou:`, error.message);
        }
      }
    }

    console.log('[Backfill-BG] complete:', JSON.stringify(summary));
     } catch (bgErr) {
       console.error('[Backfill-BG] erro:', bgErr);
     }
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob);
    }

    return new Response(
      JSON.stringify({ success: true, accepted: true, candidateId, days, message: 'Backfill iniciado em background' }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro desconhecido";
    console.error("[Backfill] Exception:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
