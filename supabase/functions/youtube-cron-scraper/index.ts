// Edge function: Coleta automática do YouTube — dispara coleta para todos os candidatos ativos.
// Executado por cron a cada 1 minuto. Fire-and-forget para evitar timeout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildAliases(fullName: string): string[] {
  const clean = fullName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = clean.split(" ").filter((p) => p.length >= 3);
  const aliases = new Set<string>();
  if (parts.length >= 2) aliases.add(`${parts[0]} ${parts[parts.length - 1]}`);
  for (const p of parts) aliases.add(p);
  aliases.delete(clean);
  return Array.from(aliases).slice(0, 4);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  try {
    const { data: candidates, error } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active");

    if (error) throw error;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ message: "Nenhum candidato ativo." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const functionUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/search-youtube-mentions`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    for (const c of candidates) {
      // fire-and-forget — cron de 1 min não pode esperar coleta longa
      fetch(functionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          candidateId: c.id,
          candidateName: c.full_name,
          candidateAliases: buildAliases(c.full_name),
          userId: c.user_id,
          maxVideos: 8,
          maxCommentsPerVideo: 50,
          maxNewComments: 150,
        }),
      }).catch((err) => {
        console.error(
          `[YOUTUBE-CRON] dispatch falhou ${c.full_name}:`,
          (err as Error).message,
        );
      });
    }

    return new Response(JSON.stringify({
      success: true,
      candidates_dispatched: candidates.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (err) {
    console.error("[YOUTUBE-CRON] erro fatal:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
