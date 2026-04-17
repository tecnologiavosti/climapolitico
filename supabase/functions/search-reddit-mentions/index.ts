import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  author: string;
  subreddit: string;
  permalink: string;
  created_utc: number;
  score: number;
  num_comments: number;
}

/**
 * Reddit Public JSON API
 * Endpoint: https://www.reddit.com/search.json?q=...
 * Não requer OAuth para leitura limitada (rate-limit ~60 req/min com User-Agent customizado).
 * Para volume maior, configure REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET e use OAuth.
 */
async function fetchRedditOAuthToken(): Promise<string | null> {
  const clientId = Deno.env.get("REDDIT_CLIENT_ID");
  const clientSecret = Deno.env.get("REDDIT_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  try {
    const auth = btoa(`${clientId}:${clientSecret}`);
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "ClimaPolitico/1.0 (by /u/climapolitico)",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { candidateName, candidateId, limit = 50 } = await req.json();

    if (!candidateName || !candidateId) {
      return new Response(
        JSON.stringify({ error: "candidateName e candidateId são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolver user_id pelo candidato (pattern usado pelas outras coletas)
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
    const userId = candidate.user_id;

    console.log(`[Reddit] Buscando menções de: ${candidateName}`);

    // Tenta OAuth se disponível, senão usa endpoint público .json
    const token = await fetchRedditOAuthToken();
    const baseUrl = token
      ? "https://oauth.reddit.com/search"
      : "https://www.reddit.com/search.json";

    const query = encodeURIComponent(`"${candidateName}"`);
    const url = `${baseUrl}?q=${query}&limit=${limit}&sort=new&t=month&restrict_sr=false`;

    const headers: Record<string, string> = {
      "User-Agent": "ClimaPolitico/1.0 (Brazilian political sentiment monitor)",
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[Reddit] HTTP ${res.status}: ${text.substring(0, 200)}`);
      return new Response(
        JSON.stringify({
          error: `Reddit API erro ${res.status}`,
          posts: [],
          total: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await res.json();
    const children = json?.data?.children ?? [];

    const posts: RedditPost[] = children.map((c: { data: RedditPost }) => c.data).filter(Boolean);
    console.log(`[Reddit] ${posts.length} posts encontrados`);

    // Salvar como interações sociais
    const interactions = posts.slice(0, limit).map((p) => ({
      user_id: userId,
      candidate_id: candidateId,
      social_network: "reddit",
      interaction_type: "post",
      comment_text: `${p.title}\n\n${(p.selftext ?? "").substring(0, 1000)}`,
      comment_author: p.author || "unknown",
      author_profile_url: `https://www.reddit.com${p.permalink ?? ""}`,
      likes_count: p.score ?? 0,
      replies_count: p.num_comments ?? 0,
      original_posted_at: p.created_utc
        ? new Date(p.created_utc * 1000).toISOString()
        : null,
      collected_at: new Date().toISOString(),
    }));

    let inserted = 0;
    if (interactions.length > 0) {
      const { error: insertError, count } = await supabase
        .from("social_interactions")
        .insert(interactions, { count: "exact" });
      if (insertError) {
        console.error("[Reddit] Erro ao salvar:", insertError);
      } else {
        inserted = count ?? interactions.length;
        console.log(`[Reddit] ${inserted} interações salvas`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        source: "reddit",
        candidateName,
        total: posts.length,
        inserted,
        oauthUsed: !!token,
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
