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

// Canais brasileiros para varrer em busca de menções (categorizados).
// Nota: nem todos podem existir no Telegram com esse handle exato — os que não
// existirem simplesmente não retornam itens (silenciosamente ignorados).
const BR_PRESS_CHANNELS = [
  // Grandes veículos
  "g1noticias", "uol", "folhadespaulo", "estadao", "cnnbrasil", "metropoles",
  "poder360", "bbcbrasil", "UOLNoticias", "band_jornalismo", "recordnews", "jovempannews",
  // Política nacional
  "politicabrasil", "brazilpolitics", "debatepolitico",
  "forumbrasileiro", "brasil247", "revistaforum",
  // Direita / conservador
  "bolsonaronews", "direitabrasil", "agora_brasil",
  "conservadoresbrasil", "patriotasbr",
  // Esquerda / progressista
  "ptbrasil", "mstnacional", "pcdobrasil",
  "movimentobrasil", "esquerda_online",
  // Fact-checking
  "aosfatos", "lupa", "agenciapublica", "comprova",
  // Regionais
  "nordeste_politica", "sul_noticias", "centroeste_br",
  "sudeste_noticias", "norte_amazonia",
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

// Stop-words comuns em nomes brasileiros que NÃO devem ser usadas como match isolado.
const NAME_STOP = new Set(["da","de","do","das","dos","e","di","du","junior","jr","filho","neto","sobrinho"]);

function semanticMatch(text: string, fullName: string): boolean {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const allParts = norm(fullName).split(/\s+/).filter(Boolean);
  const parts = allParts.filter((p) => p.length >= 3 && !NAME_STOP.has(p));
  if (parts.length === 0) return false;

  // 1) Match exato do nome completo normalizado (mais forte)
  if (t.includes(norm(fullName))) return true;

  // 2) Primeiro + último nome significativos juntos (ex: "luiz silva")
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (t.includes(`${first} ${last}`)) return true;
  }

  // 3) Sobrenome único e distintivo (≥4 chars, evita "silva"/"souza" comuns)
  // Para nomes compostos longos (3+ partes), aceita qualquer parte significativa
  // de pelo menos 4 caracteres como suficiente (ex: "Lula", "Bolsonaro").
  const COMMON_SURNAMES = new Set(["silva","souza","santos","oliveira","pereira","costa","lima","gomes","ribeiro","alves"]);
  for (const p of parts) {
    if (p.length >= 4 && !COMMON_SURNAMES.has(p) && new RegExp(`\\b${p}\\b`).test(t)) {
      return true;
    }
  }
  return false;
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
  // 1) Prioridade: scraping do HTML público t.me/s/<canal> (renderizado pelo
  // próprio Telegram, sempre acessível, não depende de instâncias terceiras).
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
    } else {
      console.warn(`[Telegram] t.me/s/${channel}: HTTP ${res.status}`);
    }
  } catch (e) {
    console.warn(`[Telegram] t.me/s/${channel} falhou: ${(e as Error).message}`);
  }

  // 2) Fallback: RSSHub público
  for (const inst of RSSHUB_INSTANCES) {
    try {
      const url = `${inst}/telegram/channel/${channel}`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[Telegram] RSSHub ${inst}/${channel}: ${items.length} itens`);
        return items;
      }
    } catch (_e) {
      // silencioso — tantas instâncias offline
    }
  }

  // 3) Fallback final: RSS-Bridge TelegramBridge
  for (const inst of RSS_BRIDGE_INSTANCES) {
    try {
      const url = `${inst}/?action=display&bridge=TelegramBridge&username=${encodeURIComponent(channel)}&format=Mrss`;
      const res = await fetch(url, {
        headers: {
          "User-Agent": randomUA(),
          "Accept": "application/rss+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml);
      if (items.length > 0) {
        console.log(`[Telegram] Bridge ${inst}/${channel}: ${items.length} itens`);
        return items;
      }
    } catch (_e) {
      // silencioso
    }
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

// ====== Coleta de COMENTÁRIOS de um post via discussão linkada ======
// Telegram canais com grupo de discussão expõem comentários no embed:
// https://t.me/<canal>/<msg_id>?embed=1&discussion=1&comments_limit=20
interface TelegramReply {
  text: string;
  author: string;
  url: string;
  postedAt: string;
}

function parseTelegramReplies(html: string, channel: string, msgId: string): TelegramReply[] {
  const out: TelegramReply[] = [];
  // Cada reply: <div class="tgme_widget_message ..." data-post="discussionGroup/ID">
  const msgRe = /<div[^>]*class="[^"]*tgme_widget_message\b[^"]*"[^>]*data-post="([^"]+)"[\s\S]*?(?=<div[^>]*class="[^"]*tgme_widget_message\b|<\/section)/gi;
  let m: RegExpExecArray | null;
  while ((m = msgRe.exec(html)) !== null) {
    const block = m[0];
    const postId = m[1];
    // Pula o post original (mesmo canal/msgId)
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
    out.push({
      text: text.slice(0, 4000),
      author,
      url: `https://t.me/${postId}`,
      postedAt,
    });
  }
  return out;
}

async function fetchTelegramReplies(channel: string, msgId: string): Promise<TelegramReply[]> {
  const url = `https://t.me/${channel}/${msgId}?embed=1&discussion=1&comments_limit=20&mode=tme`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": randomUA(),
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.warn(`[Telegram-Replies] ${channel}/${msgId}: HTTP ${res.status}`);
      return [];
    }
    const html = await res.text();
    // Verifica se a página tem widget de comentários (canal precisa ter discussão linkada)
    if (!html.includes("tgme_widget_message")) return [];
    const replies = parseTelegramReplies(html, channel, msgId);
    if (replies.length > 0) {
      console.log(`[Telegram-Replies] ${channel}/${msgId}: ${replies.length} comentários`);
    }
    return replies;
  } catch (e) {
    console.warn(`[Telegram-Replies] ${channel}/${msgId} falhou: ${(e as Error).message}`);
    return [];
  }
}

function extractTelegramMsgId(url: string): { channel: string; msgId: string } | null {
  const m = url.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]{4,32})\/(\d+)/i);
  if (!m) return null;
  return { channel: m[1].toLowerCase(), msgId: m[2] };
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

    // === Background job ===
    const backgroundJob = (async () => {
     try {
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
      console.log(`[Telegram-BG] 0 matches em ${channels.length} canais`);
      return;
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

    // ========= COLETA DE COMENTÁRIOS via discussão linkada =========
    let repliesInserted = 0;
    const postsForReplies = rows.slice(0, Math.min(rows.length, 20));
    if (postsForReplies.length > 0) {
      const replyArrays = await Promise.all(
        postsForReplies.map((p) => {
          const ref = extractTelegramMsgId(p.author_profile_url);
          return ref ? fetchTelegramReplies(ref.channel, ref.msgId) : Promise.resolve([]);
        }),
      );
      const allReplies: any[] = [];
      for (let i = 0; i < postsForReplies.length; i++) {
        for (const r of replyArrays[i]) {
          allReplies.push({
            user_id: userId,
            candidate_id: candidateId,
            social_network: "Telegram",
            interaction_type: "reply",
            comment_text: r.text,
            comment_author: r.author,
            author_profile_url: r.url,
            original_posted_at: r.postedAt,
            collected_at: new Date().toISOString(),
            likes_count: 0,
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
          .eq("social_network", "Telegram")
          .eq("interaction_type", "reply")
          .in("author_profile_url", replyUrls);
        const exSet = new Set((existingReplies ?? []).map((e: any) => e.author_profile_url));
        const freshReplies = allReplies.filter((r) => !exSet.has(r.author_profile_url));
        if (freshReplies.length > 0) {
          const { error: repErr } = await supabase
            .from("social_interactions")
            .insert(freshReplies);
          if (repErr) {
            console.error("[Telegram-Replies] insert falhou:", repErr.message);
          } else {
            repliesInserted = freshReplies.length;
            console.log(`[Telegram-Replies] ${candidateName}: ${repliesInserted} comentários inseridos`);
          }
        }
      }
    }

    console.log(`[Telegram-BG] complete: inserted=${inserted} replies=${repliesInserted}`);
     } catch (bgErr) {
       console.error('[Telegram-BG] erro:', bgErr);
     }
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(backgroundJob);
    }

    return new Response(
      JSON.stringify({ success: true, accepted: true, message: 'Coleta Telegram iniciada em background' }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
