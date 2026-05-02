// Edge function: Coleta automática do Twitter/X via rede de instâncias Nitter (RSS)
// Executa a cada minuto via cron job, rotaciona entre instâncias saudáveis e
// salva os tweets na tabela `social_interactions` (SSOT) para cada candidato monitorado.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_TWEETS_PER_CANDIDATE = 600;
const MAX_PAGES_PER_CANDIDATE = 12;

function buildCandidateAliases(fullName: string): string[] {
  const clean = fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = clean.split(" ").filter((part) => part.length >= 3);
  const aliases = new Set<string>();

  if (parts.length >= 2) aliases.add(`${parts[0]} ${parts[parts.length - 1]}`);
  if (parts.length >= 3) aliases.add(parts.slice(-2).join(" "));
  for (const part of parts) aliases.add(part);

  aliases.delete(clean);
  return Array.from(aliases).slice(0, 6);
}

// Disparo "fire-and-forget": o cron roda a cada 1 min e a coleta profunda
// pode levar vários minutos por candidato. Em vez de esperar, disparamos
// em paralelo e respondemos imediatamente para não bater em timeout.

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

    // 2. Disparar coleta profunda em paralelo (sem esperar) para cada candidato
    for (const candidate of candidates) {
      fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          candidateId: candidate.id,
          candidateName: candidate.full_name,
          candidateAliases: buildCandidateAliases(candidate.full_name),
          userId: candidate.user_id,
          maxTweets: MAX_TWEETS_PER_CANDIDATE,
          maxPages: MAX_PAGES_PER_CANDIDATE,
        }),
      }).catch((err) => {
        console.error(
          `[NITTER] Falha ao disparar coletor para ${candidate.full_name}:`,
          (err as Error).message,
        );
      });
      perCandidate.push({
        name: candidate.full_name,
        collected: 0,
        inserted: 0,
        instance: "search-twitter-mentions (dispatched)",
      });
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
