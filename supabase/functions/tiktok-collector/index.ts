// TikTok scraping leve via Urlebird (visualizador anônimo público).
// Coleta posts (legendas) e tenta extrair comentários visíveis.
// Sem API key, com rotação de User-Agents.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

interface PostItem {
  url: string;
  caption: string;
}

function deriveTikTokHandle(candidate: { full_name: string; social_media_link: string | null }): string | null {
  // Tenta extrair handle de social_media_link tipo https://www.tiktok.com/@handle
  const link = candidate.social_media_link || "";
  const m = link.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
  if (m?.[1]) return m[1];
  // Fallback: nome normalizado (sem espaços, lowercase) — pode falhar, mas é melhor que nada.
  const slug = candidate.full_name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  return slug || null;
}

function extractPosts(html: string): PostItem[] {
  // Urlebird lista cards de vídeo com link tipo /video/<id>/ e legenda em alt/text próximo.
  const out: PostItem[] = [];
  const re = /<a[^>]+href="(\/video\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+alt="([^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({
      url: `https://urlebird.com${m[1]}`,
      caption: m[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function extractComments(html: string): { author: string; text: string }[] {
  const out: { author: string; text: string }[] = [];
  // Padrão genérico: blocos de comentário com classe contendo "comment".
  const re = /<div[^>]*class="[^"]*comment[^"]*"[\s\S]*?<(?:span|a|div)[^>]*class="[^"]*(?:author|name|user)[^"]*"[^>]*>([^<]+)<\/[^>]+>[\s\S]*?<(?:p|div|span)[^>]*class="[^"]*(?:text|content|body)[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const author = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (author && text) out.push({ author, text: text.substring(0, 500) });
    if (out.length >= 30) break;
  }
  return out;
}

async function collectForCandidate(
  supabase: ReturnType<typeof createClient>,
  candidate: { id: string; full_name: string; user_id: string; social_media_link: string | null },
): Promise<{ posts: number; comments: number }> {
  const handle = deriveTikTokHandle(candidate);
  if (!handle) return { posts: 0, comments: 0 };

  let postsInserted = 0;
  let commentsInserted = 0;

  try {
    const profileUrl = `https://urlebird.com/user/${handle}/`;
    const resp = await fetch(profileUrl, { headers: { "User-Agent": randomUA() } });
    if (!resp.ok) {
      console.warn(`[tiktok-collector] ${handle}: profile HTTP ${resp.status}`);
      return { posts: 0, comments: 0 };
    }
    const html = await resp.text();
    const posts = extractPosts(html).slice(0, 10);
    if (posts.length === 0) {
      console.warn(`[tiktok-collector] ${handle}: 0 posts extraídos`);
      return { posts: 0, comments: 0 };
    }

    // Deduplica por URL
    const urls = posts.map((p) => p.url);
    const { data: existing } = await supabase
      .from("social_interactions")
      .select("author_profile_url")
      .eq("candidate_id", candidate.id)
      .eq("social_network", "tiktok")
      .in("author_profile_url", urls);
    const existingSet = new Set((existing || []).map((e) => e.author_profile_url));

    const newPosts = posts.filter((p) => !existingSet.has(p.url));
    if (newPosts.length > 0) {
      const rows = newPosts.map((p) => ({
        user_id: candidate.user_id,
        candidate_id: candidate.id,
        social_network: "tiktok",
        interaction_type: "post",
        comment_text: p.caption || "Vídeo do TikTok",
        comment_author: handle,
        author_profile_url: p.url,
        original_posted_at: null,
        collected_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("social_interactions").insert(rows);
      if (error) console.error(`[tiktok-collector] insert posts erro:`, error.message);
      else postsInserted = rows.length;
    }

    // Coleta comentários dos primeiros 5 posts (limitar para evitar timeout)
    for (const p of posts.slice(0, 5)) {
      try {
        const vr = await fetch(p.url, { headers: { "User-Agent": randomUA() } });
        if (!vr.ok) continue;
        const vh = await vr.text();
        const comments = extractComments(vh);
        if (comments.length === 0) continue;

        // Dedup por (post url + author + first 80 chars)
        const fingerprints = comments.map((c) => `${p.url}#${c.author}#${c.text.substring(0, 80)}`);
        const { data: existCom } = await supabase
          .from("social_interactions")
          .select("author_profile_url")
          .eq("candidate_id", candidate.id)
          .eq("social_network", "tiktok")
          .eq("interaction_type", "comment")
          .in("author_profile_url", fingerprints);
        const existSet = new Set((existCom || []).map((e) => e.author_profile_url));

        const newComs = comments
          .map((c) => ({ c, fp: `${p.url}#${c.author}#${c.text.substring(0, 80)}` }))
          .filter((x) => !existSet.has(x.fp));

        if (newComs.length === 0) continue;

        const crows = newComs.map(({ c, fp }) => ({
          user_id: candidate.user_id,
          candidate_id: candidate.id,
          social_network: "tiktok",
          interaction_type: "comment",
          comment_text: c.text,
          comment_author: c.author,
          author_profile_url: fp,
          original_posted_at: null,
          collected_at: new Date().toISOString(),
        }));
        const { error: cErr } = await supabase.from("social_interactions").insert(crows);
        if (cErr) console.warn(`[tiktok-collector] comments insert erro:`, cErr.message);
        else commentsInserted += crows.length;
      } catch (e) {
        console.warn(`[tiktok-collector] comentários falharam em ${p.url}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (err) {
    console.error(`[tiktok-collector] erro candidato ${candidate.full_name}:`, err instanceof Error ? err.message : err);
  }

  console.log(`[tiktok-collector] ${candidate.full_name} (@${handle}): +${postsInserted} posts, +${commentsInserted} comentários`);
  return { posts: postsInserted, comments: commentsInserted };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { candidateId } = body as { candidateId?: string };

    if (candidateId) {
      // Coleta single candidato (manual, síncrona)
      const { data: c, error } = await supabase
        .from("candidates")
        .select("id, full_name, user_id, social_media_link")
        .eq("id", candidateId)
        .maybeSingle();
      if (error || !c) {
        return new Response(JSON.stringify({ error: "Candidato não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await collectForCandidate(supabase, c);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Coleta global em background (cron)
    const job = (async () => {
      const { data: candidates } = await supabase
        .from("candidates")
        .select("id, full_name, user_id, social_media_link")
        .eq("status", "active");
      if (!candidates) return;
      for (const c of candidates) {
        await collectForCandidate(supabase, c);
      }
    })();
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(job);

    return new Response(JSON.stringify({ message: "Coleta TikTok iniciada em background", status: "processing" }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[tiktok-collector] erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
