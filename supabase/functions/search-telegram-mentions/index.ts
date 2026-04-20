// Edge function: coleta menções do Telegram para 1 candidato.
// Estratégia: lê RSS de canais públicos do Telegram via RSSHub e RSS-Bridge
// (TelegramBridge). Não requer bot, não requer admin nos canais.
//
// Cobre dois casos:
//   1) Posts do próprio candidato → se candidates.social_media_link contiver
//      "t.me/<handle>", pega o canal direto.
//   2) Menções em canais de imprensa BR fixos → busca o nome do candidato
//      no histórico recente desses canais.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// RSSHub instances (público). Endpoint: /telegram/channel/:username
const RSSHUB_INSTANCES = [
  "https://rsshub.app",
  "https://rsshub.rssforever.com",
  "https://rss.shab.fun",
  "https://rsshub.pseudoyu.com",
  "https://rsshub.atgw.io",
  "https://rsshub.kt.gy",
  "https://rss.injahow.cn",
];

// RSS-Bridge instances (público). Endpoint: TelegramBridge by @username
const RSS_BRIDGE_INSTANCES = [
  "https://rss-bridge.org/bridge01",
  "https://bridge.sysadmins.ws",
  "https://rss.nixnet.services",
  "https://wtf.roflcopter.fr/rss-bridge",
  "https://rss.0v0.email",
];

// Canais brasileiros de imprensa/política para varrer em busca de menções.
// Mantemos uma lista enxuta de canais grandes e abertos ao público.
const BR_PRESS_CHANNELS = [
  "g1noticias",
  "uol",
  "folhadespaulo",
  "estadao",
  "cnnbrasil",
  "metropoles",
  "poder360",
  "bbcbrasil",
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

function extractTelegramHandle(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/(?:t\.me|telegram\.me)\/(?:s\/)?@?([a-zA-Z0-9_]{4,32})/i);
  if (!m) return null;
  const h = m[1];
  // Ignorar joinchat / +invites
  if (/^(joinchat|\+)/i.test(h)) return null;
  return h.toLowerCase();
}

async function fetchChannelRss(channel: string): Promise<Array<Record<string, string>>> {
  // Tenta RSSHub primeiro
  for (const inst of RSSHUB_INSTANCES) {
    try {
      const url = `${inst}/telegram/channel/${channel}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[Telegram] RSSHub ${inst}/${channel}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[Telegram] RSSHub ${inst}/${channel}: ${items.length} itens`);
        return items;
      }
    } catch (e) {
      console.warn(`[Telegram] RSSHub ${inst}/${channel} falhou: ${(e as Error).message}`);
    }
  }
  // Fallback: RSS-Bridge TelegramBridge
  for (const inst of RSS_BRIDGE_INSTANCES) {
    try {
      const url = `${inst}/?action=display&bridge=TelegramBridge&username=${encodeURIComponent(channel)}&format=Mrss`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        console.warn(`[Telegram] Bridge ${inst}/${channel}: HTTP ${res.status}`);
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[Telegram] Bridge ${inst}/${channel}: ${items.length} itens`);
        return items;
      }
    } catch (e) {
      console.warn(`[Telegram] Bridge ${inst}/${channel} falhou: ${(e as Error).message}`);
    }
  }
  // Fallback final: scrape HTML público de t.me/s/<canal>
  // Esta página é renderizada pelo próprio Telegram e é sempre pública.
  try {
    const url = `https://t.me/s/${channel}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const html = await res.text();
      const items = parseTelegramHtml(html, channel);
      if (items.length > 0) {
        console.log(`[Telegram] t.me/s/${channel}: ${items.length} itens (HTML)`);
        return items;
      }
      console.warn(`[Telegram] t.me/s/${channel}: HTML sem mensagens (canal privado?)`);
    } else {
      console.warn(`[Telegram] t.me/s/${channel}: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[Telegram] t.me/s/${channel} falhou: ${(e as Error).message}`);
  }
  return [];
}

// Parser para a página pública t.me/s/<canal>
function parseTelegramHtml(html: string, channel: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = [];
  // Cada mensagem fica em <div class="tgme_widget_message ..." data-post="canal/ID">
  const msgRe = /<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi;
  let m: RegExpExecArray | null;
  while ((m = msgRe.exec(html)) !== null) {
    const block = m[0];
    const postId = m[1]; // ex: "g1noticias/12345"
    // Texto da mensagem
    const textMatch = block.match(/<div[^>]*class="[^"]*tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const text = textMatch ? stripHtml(textMatch[1]) : "";
    if (!text || text.length < 10) continue;
    // Data do post
    const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);
    const pubDate = dateMatch ? dateMatch[1] : new Date().toISOString();
    items.push({
      title: text.slice(0, 200),
      link: `https://t.me/${postId}`,
      description: text,
      author: `@${channel}`,
      pubDate,
    });
  }
  return items;
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

    const {
      candidateName,
      candidateId,
      limit = 60,
      pressChannels = BR_PRESS_CHANNELS,
    } = await req.json();

    if (!candidateName || !candidateId) {
      return new Response(
        JSON.stringify({ error: "candidateName e candidateId são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: candidate, error: candErr } = await supabase
      .from("candidates")
      .select("user_id, social_media_link")
      .eq("id", candidateId)
      .single();
    if (candErr || !candidate) {
      return new Response(
        JSON.stringify({ error: "Candidato não encontrado" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const userId = candidate.user_id as string;

    // Monta lista de canais a varrer
    const channelsToScan = new Set<string>(pressChannels.map((c: string) => c.toLowerCase()));
    const ownHandle = extractTelegramHandle(candidate.social_media_link);
    if (ownHandle) {
      channelsToScan.add(ownHandle);
      console.log(`[Telegram] Canal próprio detectado: @${ownHandle}`);
    }

    console.log(`[Telegram] Varrendo ${channelsToScan.size} canais para "${candidateName}"`);

    // Busca todos os feeds em paralelo
    const channels = [...channelsToScan];
    const results = await Promise.all(channels.map((c) => fetchChannelRss(c)));

    const rows: any[] = [];
    let totalItems = 0;
    let skipped = 0;

    for (let i = 0; i < channels.length; i++) {
      const channel = channels[i];
      const items = results[i];
      totalItems += items.length;
      const isOwnChannel = ownHandle && channel === ownHandle;

      for (const it of items) {
        const content = `${it.title}\n${it.description}`.slice(0, 4000).trim();
        const link = it.link;
        if (!link || !content) { skipped++; continue; }

        // Em canais de imprensa, exige menção ao candidato.
        // No próprio canal do candidato, aceita todos os posts.
        if (!isOwnChannel && !semanticMatch(content, candidateName)) {
          skipped++;
          continue;
        }

        rows.push({
          user_id: userId,
          candidate_id: candidateId,
          social_network: "Telegram",
          interaction_type: "post",
          comment_text: content,
          comment_author: `@${channel}`,
          author_profile_url: link,
          original_posted_at: it.pubDate
            ? new Date(it.pubDate).toISOString()
            : new Date().toISOString(),
          collected_at: new Date().toISOString(),
          likes_count: 0,
          replies_count: 0,
          shares_count: 0,
        });
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          source: "telegram",
          candidateName,
          channelsScanned: channels.length,
          totalItemsFound: totalItems,
          inserted: 0,
          skipped,
          message: totalItems === 0
            ? "Nenhum canal retornou itens via RSSHub/RSS-Bridge."
            : "Nenhuma menção encontrada nos canais varridos.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Dedup por author_profile_url (URL do post)
    const urls = rows.map((r) => r.author_profile_url);
    const { data: existing } = await supabase
      .from("social_interactions")
      .select("author_profile_url")
      .eq("candidate_id", candidateId)
      .eq("social_network", "Telegram")
      .in("author_profile_url", urls);
    const existingSet = new Set((existing ?? []).map((e: any) => e.author_profile_url));
    const fresh = rows.filter((r) => !existingSet.has(r.author_profile_url));

    let inserted = 0;
    if (fresh.length > 0) {
      const { error: insertError } = await supabase
        .from("social_interactions")
        .insert(fresh);
      if (insertError) {
        console.error("[Telegram] insert falhou:", insertError.message);
      } else {
        inserted = fresh.length;
        console.log(`[Telegram] ${candidateName}: ${inserted} novos posts inseridos`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: "telegram",
        candidateName,
        channelsScanned: channels.length,
        totalItemsFound: totalItems,
        matched: rows.length,
        inserted,
        skipped,
        duplicates: rows.length - fresh.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[Telegram] Exception:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
