// Edge function: Coleta automática do Twitter/X via rede de instâncias Nitter (RSS)
// Executa a cada minuto via cron job, rotaciona entre instâncias saudáveis e
// salva os tweets na tabela `social_interactions` (SSOT) para cada candidato monitorado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TWEETS_PER_CANDIDATE = 250;
const MAX_PAGES_PER_CANDIDATE = 6;

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    // 1. Buscar todos os candidatos monitorados de todos os usuários
    const { data: candidates, error: candidatesError } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active");

    if (candidatesError) throw candidatesError;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nenhum candidato ativo para coletar." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    let totalInserted = 0;
    let totalCollected = 0;
    const perCandidate: Array<{ name: string; collected: number; inserted: number; instance: string | null }> = [];

    const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/search-twitter-mentions`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // 2. Para cada candidato, usar o coletor profundo do Twitter/X
    for (const candidate of candidates) {
      try {
        const response = await fetchWithTimeout(
          functionUrl,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              candidateId: candidate.id,
              candidateName: candidate.full_name,
              userId: candidate.user_id,
              maxTweets: MAX_TWEETS_PER_CANDIDATE,
              maxPages: MAX_PAGES_PER_CANDIDATE,
            }),
          },
          REQUEST_TIMEOUT_MS,
        );

        const raw = await response.text();
        const payload = raw ? JSON.parse(raw) : {};

        if (!response.ok) {
          throw new Error(payload?.details || payload?.error || `HTTP ${response.status}`);
        }

        const collected = Number(payload?.totalFound ?? 0);
        const inserted = Number(payload?.inserted ?? 0);
        totalCollected += collected;
        totalInserted += inserted;
        perCandidate.push({
          name: candidate.full_name,
          collected,
          inserted,
          instance: "search-twitter-mentions",
        });
      } catch (err) {
        console.error(`[NITTER] Erro no coletor profundo para ${candidate.full_name}:`, (err as Error).message);
        perCandidate.push({
          name: candidate.full_name,
          collected: 0,
          inserted: 0,
          instance: null,
        });
        continue;
      }

      totalInserted += inserted;
    }

    return new Response(
      JSON.stringify({
        success: true,
        candidates_processed: candidates.length,
        total_collected: totalCollected,
        total_inserted: totalInserted,
        details: perCandidate,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    console.error("[NITTER] Erro fatal:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
