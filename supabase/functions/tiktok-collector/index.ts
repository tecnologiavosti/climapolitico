// TikTok collector usando Tikwm.com (API JSON pública gratuita) com fallback RSSHub.
// Coleta posts (legendas) e comentários reais sem precisar de API key oficial do TikTok.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
];
const randomUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

interface TikwmPost {
  video_id: string;
  title: string;
  create_time: number;
  digg_count?: number;
  comment_count?: number;
  share_count?: number;
  play_count?: number;
  author?: { unique_id?: string; nickname?: string };
}

interface TikwmComment {
  id?: string;
  cid?: string;
  text: string;
  user?: { unique_id?: string; nickname?: string };
  digg_count?: number;
  create_time?: number;
}

interface ExistingInteractionRow {
  author_profile_url: string | null;
}

function deriveTikTokHandle(candidate: { full_name: string; social_media_link: string | null }): string | null {
  const link = candidate.social_media_link || "";
  const m = link.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
  if (m?.[1]) return m[1];
  return null;
}

async function autoResolveHandle(
  supabase: any,
  candidate: { id: string; full_name: string; social_media_link: string | null },
): Promise<string | null> {
  try {
    console.log(`[tiktok-collector] Auto-resolvendo handle de ${candidate.full_name} via Firecrawl...`);
    const { data, error } = await supabase.functions.invoke("tiktok-resolve-handle", {
      body: { candidateId: candidate.id, autoSave: true },
    });
    if (error) {
      console.warn(`[tiktok-collector] auto-resolve erro:`, error.message);
      return null;
    }
    if (data?.handle) {
      console.log(`[tiktok-collector] Handle resolvido: @${data.handle} (${data.reason || ""})`);
    }
    return data?.handle || null;
  } catch (e) {
    console.warn(`[tiktok-collector] auto-resolve exceção:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function fetchTikwmPosts(handle: string): Promise<TikwmPost[]> {
  const url = `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(handle)}&count=15&cursor=0`;
  const resp = await fetch(url, { headers: { "User-Agent": randomUA(), "Accept": "application/json" } });
  if (!resp.ok) throw new Error(`tikwm posts HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.code !== 0) throw new Error(`tikwm code ${json?.code}: ${json?.msg}`);
  return (json?.data?.videos || []) as TikwmPost[];
}

async function fetchTikwmSearch(keyword: string, count = 20): Promise<TikwmPost[]> {
  const url = `https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&count=${count}&cursor=0`;
  const resp = await fetch(url, { headers: { "User-Agent": randomUA(), "Accept": "application/json" } });
  if (!resp.ok) throw new Error(`tikwm search HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.code !== 0) throw new Error(`tikwm search code ${json?.code}: ${json?.msg}`);
  return (json?.data?.videos || []) as TikwmPost[];
}

async function fetchTikwmComments(videoId: string): Promise<TikwmComment[]> {
  const url = `https://www.tikwm.com/api/comment/list?aweme_id=${encodeURIComponent(videoId)}&count=30&cursor=0`;
  const resp = await fetch(url, { headers: { "User-Agent": randomUA(), "Accept": "application/json" } });
  if (!resp.ok) throw new Error(`tikwm comments HTTP ${resp.status}`);
  const json = await resp.json();
  if (json?.code !== 0) return [];
  return (json?.data?.comments || []) as TikwmComment[];
}

// Fallback Apify: clockworks/tiktok-scraper (free tier 500 créditos/mês).
// Acionado quando Tikwm retorna 0 vídeos para o candidato.
async function fetchApifyTikTokSearch(keyword: string): Promise<TikwmPost[]> {
  const token = Deno.env.get("APIFY_API_TOKEN");
  if (!token) {
    console.warn(`[tiktok-collector] APIFY_API_TOKEN ausente — fallback Apify desabilitado`);
    return [];
  }
  try {
    const url = `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=${token}&timeout=120`;
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchQueries: [keyword],
        resultsPerPage: 30,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        proxyCountryCode: "BR",
      }),
      signal: AbortSignal.timeout(150000),
    });
    if (!resp.ok) {
      console.warn(`[tiktok-collector] Apify HTTP ${resp.status}`);
      return [];
    }
    const items = await resp.json();
    if (!Array.isArray(items)) return [];
    // Normaliza para o shape TikwmPost
    return items.map((it: any) => ({
      video_id: String(it.id || it.itemId || ""),
      title: it.text || it.desc || "",
      create_time: it.createTime || (it.createTimeISO ? Math.floor(new Date(it.createTimeISO).getTime() / 1000) : 0),
      digg_count: it.diggCount || it.likes || 0,
      comment_count: it.commentCount || it.comments || 0,
      share_count: it.shareCount || it.shares || 0,
      play_count: it.playCount || it.views || 0,
      author: {
        unique_id: it.authorMeta?.name || it["authorMeta.name"] || it.author?.uniqueId || "",
        nickname: it.authorMeta?.nickName || it.author?.nickname || "",
      },
    })).filter((p: TikwmPost) => p.video_id);
  } catch (e) {
    console.warn(`[tiktok-collector] Apify falhou:`, e instanceof Error ? e.message : e);
    return [];
  }
}

async function collectForCandidate(
  supabase: any,
  candidate: { id: string; full_name: string; user_id: string; social_media_link: string | null },
): Promise<{ posts: number; comments: number; handle: string | null; mode?: string; error?: string }> {
  let handle = deriveTikTokHandle(candidate);
  if (!handle) {
    // Tenta resolver via Firecrawl (não bloqueia se falhar)
    handle = await autoResolveHandle(supabase, candidate);
  }

  let postsInserted = 0;
  let commentsInserted = 0;
  let posts: TikwmPost[] = [];
  let sourceMode: "profile" | "search" = "profile";

  try {
    if (handle) {
      try {
        posts = await fetchTikwmPosts(handle);
      } catch (e) {
        console.warn(`[tiktok-collector] tikwm posts @${handle} falhou:`, e instanceof Error ? e.message : e);
      }
    }

    // Fallback: busca por nome do candidato (sempre que perfil retornar 0 ou não houver handle)
    if (posts.length === 0) {
      sourceMode = "search";
      try {
        console.log(`[tiktok-collector] Fallback: buscando "${candidate.full_name}" na Tikwm...`);
        posts = await fetchTikwmSearch(candidate.full_name, 20);
        console.log(`[tiktok-collector] Search retornou ${posts.length} vídeos para "${candidate.full_name}"`);
      } catch (e) {
        console.warn(`[tiktok-collector] tikwm search falhou:`, e instanceof Error ? e.message : e);
      }
    }

    // Fallback final: Apify (clockworks/tiktok-scraper) — só roda se Tikwm zerar
    if (posts.length === 0) {
      sourceMode = "search";
      console.log(`[tiktok-collector] Fallback Apify para "${candidate.full_name}"...`);
      posts = await fetchApifyTikTokSearch(candidate.full_name);
      console.log(`[tiktok-collector] Apify retornou ${posts.length} vídeos`);
    }

    if (posts.length === 0) {
      return { posts: 0, comments: 0, handle, error: "Nenhum vídeo encontrado (Tikwm + Apify)" };
    }

    // Builder de URL: usa handle do post (modo search) ou handle do candidato (modo profile)
    const buildUrl = (p: TikwmPost) => {
      const author = p.author?.unique_id || handle || "tiktok";
      return `https://www.tiktok.com/@${author}/video/${p.video_id}`;
    };

    // Dedup posts por URL
    const videoUrls = posts.map(buildUrl);
    const { data: existing } = await supabase
      .from("social_interactions")
      .select("author_profile_url")
      .eq("candidate_id", candidate.id)
      .eq("social_network", "tiktok")
      .in("author_profile_url", videoUrls);
    const existingSet = new Set(((existing || []) as ExistingInteractionRow[]).map((e) => e.author_profile_url));

    const newPosts = posts.filter((p) => !existingSet.has(buildUrl(p)));
    if (newPosts.length > 0) {
      const rows = newPosts.map((p) => ({
        user_id: candidate.user_id,
        candidate_id: candidate.id,
        social_network: "tiktok",
        interaction_type: sourceMode === "search" ? "mention" : "post",
        comment_text: p.title || "Vídeo do TikTok",
        comment_author: p.author?.unique_id || p.author?.nickname || handle || "tiktok",
        author_profile_url: buildUrl(p),
        likes_count: p.digg_count || 0,
        replies_count: p.comment_count || 0,
        shares_count: p.share_count || 0,
        original_posted_at: p.create_time ? new Date(p.create_time * 1000).toISOString() : null,
        collected_at: new Date().toISOString(),
      }));
      const { error } = await supabase.from("social_interactions").insert(rows);
      if (error) console.error(`[tiktok-collector] insert posts erro:`, error.message);
      else postsInserted = rows.length;
    }

    // Coleta comentários dos primeiros 5 posts
    for (const p of posts.slice(0, 5)) {
      try {
        const comments = await fetchTikwmComments(p.video_id);
        if (comments.length === 0) continue;

        const fingerprints = comments.map((c) => `tt-c-${p.video_id}-${c.id || c.cid || c.text.substring(0, 40)}`);
        const { data: existCom } = await supabase
          .from("social_interactions")
          .select("author_profile_url")
          .eq("candidate_id", candidate.id)
          .eq("social_network", "tiktok")
          .eq("interaction_type", "comment")
          .in("author_profile_url", fingerprints);
        const existSet = new Set(((existCom || []) as ExistingInteractionRow[]).map((e) => e.author_profile_url));

        const newComs = comments
          .map((c) => ({ c, fp: `tt-c-${p.video_id}-${c.id || c.cid || c.text.substring(0, 40)}` }))
          .filter((x) => !existSet.has(x.fp));

        if (newComs.length === 0) continue;

        const crows = newComs.map(({ c, fp }) => ({
          user_id: candidate.user_id,
          candidate_id: candidate.id,
          social_network: "tiktok",
          interaction_type: "comment",
          comment_text: (c.text || "").substring(0, 1000),
          comment_author: c.user?.unique_id || c.user?.nickname || "anonymous",
          author_profile_url: fp,
          likes_count: c.digg_count || 0,
          original_posted_at: c.create_time ? new Date(c.create_time * 1000).toISOString() : null,
          collected_at: new Date().toISOString(),
        }));
        const { error: cErr } = await supabase.from("social_interactions").insert(crows);
        if (cErr) console.warn(`[tiktok-collector] insert comments erro:`, cErr.message);
        else commentsInserted += crows.length;

        // Pequeno delay para não sobrecarregar o tikwm
        await new Promise((r) => setTimeout(r, 300));
      } catch (e) {
        console.warn(`[tiktok-collector] comentários falharam em ${p.video_id}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (err) {
    console.error(`[tiktok-collector] erro candidato ${candidate.full_name}:`, err instanceof Error ? err.message : err);
    return { posts: postsInserted, comments: commentsInserted, handle, error: err instanceof Error ? err.message : "erro desconhecido" };
  }

  console.log(`[tiktok-collector] ${candidate.full_name} [${sourceMode}${handle ? ` @${handle}` : ""}]: +${postsInserted} posts, +${commentsInserted} comentários`);
  return { posts: postsInserted, comments: commentsInserted, handle, mode: sourceMode };
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

    const job = (async () => {
      const { data: candidates } = await supabase
        .from("candidates")
        .select("id, full_name, user_id, social_media_link")
        .eq("status", "active");
      if (!candidates) return;
      for (const c of candidates) {
        await collectForCandidate(supabase, c);
        await new Promise((r) => setTimeout(r, 500));
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
