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

    const items = await fetchViaRssBridge(`"${candidateName}"`);

    if (items.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          source: "reddit",
          candidateName,
          total: 0,
          inserted: 0,
          message: "Nenhum item retornado por nenhuma instância RSS-Bridge.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const rows: any[] = [];
    let skipped = 0;
    for (const it of items.slice(0, limit)) {
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
      return new Response(
        JSON.stringify({
          success: true, source: "reddit", candidateName,
          total: items.length, inserted: 0, skipped,
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

    return new Response(
      JSON.stringify({
        success: true,
        source: "reddit",
        candidateName,
        total: items.length,
        inserted,
        skipped,
        duplicates: rows.length - fresh.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
