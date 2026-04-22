// Edge function: busca Wikipedia e insere como social_interaction (Wikipedia source)
// Compatível com chamadas antigas (sem candidateId apenas retorna o resumo).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface WikipediaResult {
  title: string;
  extract: string;
  pageUrl: string;
  thumbnail?: string;
}

async function fetchSummary(title: string): Promise<WikipediaResult | null> {
  const url = `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "ClimaPolitico/1.0 (https://climapolitico.lovable.app)",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return {
    title: d.title,
    extract: d.extract || "",
    pageUrl: d.content_urls?.desktop?.page || `https://pt.wikipedia.org/wiki/${encodeURIComponent(d.title)}`,
    thumbnail: d.thumbnail?.source,
  };
}

async function searchAndPickFirst(candidateName: string): Promise<WikipediaResult | null> {
  // Tenta direto
  const direct = await fetchSummary(candidateName);
  if (direct && direct.extract) return direct;
  // Search API
  const url = `https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(candidateName)}&format=json&srlimit=3`;
  const r = await fetch(url, {
    headers: { "User-Agent": "ClimaPolitico/1.0", "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return null;
  const data = await r.json();
  const first = data?.query?.search?.[0];
  if (!first) return null;
  return await fetchSummary(first.title);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { candidateName, candidateId } = await req.json();
    if (!candidateName) {
      return new Response(JSON.stringify({ error: "candidateName é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await searchAndPickFirst(candidateName);
    if (!result) {
      return new Response(JSON.stringify({ found: false, candidateName }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Se candidateId foi enviado, persiste como social_interaction
    let inserted = 0;
    if (candidateId) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
        { auth: { persistSession: false } },
      );
      const { data: cand } = await supabase
        .from("candidates")
        .select("user_id")
        .eq("id", candidateId)
        .maybeSingle();
      if (cand?.user_id) {
        // Dedup por author_profile_url
        const { data: existing } = await supabase
          .from("social_interactions")
          .select("id")
          .eq("candidate_id", candidateId)
          .eq("social_network", "Wikipedia")
          .eq("author_profile_url", result.pageUrl)
          .maybeSingle();
        if (!existing) {
          const { error } = await supabase.from("social_interactions").insert({
            user_id: cand.user_id,
            candidate_id: candidateId,
            social_network: "Wikipedia",
            interaction_type: "article",
            comment_text: result.extract.slice(0, 4000),
            comment_author: "Wikipedia",
            author_profile_url: result.pageUrl,
            sentiment_label: "Neutro",
            sentiment_score: 0.5,
            likes_count: 0,
            replies_count: 0,
            shares_count: 0,
            collected_at: new Date().toISOString(),
            original_posted_at: new Date().toISOString(),
          });
          if (!error) inserted = 1;
          else console.error("[Wikipedia] insert falhou:", error.message);
        }
      }
    }

    return new Response(JSON.stringify({
      found: true,
      ...result,
      source: "wikipedia",
      candidateName,
      inserted,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("[Wikipedia] erro:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
