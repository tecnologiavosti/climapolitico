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
    // Auto-pause via quota
    const { data: skipData } = await supabase.rpc("should_skip_collector", { _name: "youtube" });
    if (skipData === true) {
      console.log("[YOUTUBE-CRON] pulado por quota");
      return new Response(JSON.stringify({ skipped: true, reason: "quota" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const dispatchJob = (async () => {
      for (const c of candidates) {
        try {
          const response = await fetch(functionUrl, {
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
          maxVideos: 12,
          maxCommentsPerVideo: 100,
          maxNewComments: 300,
        }),
          });
          if (!response.ok) {
            console.warn(`[YOUTUBE-CRON] ${c.full_name}: HTTP ${response.status} ${await response.text()}`);
          } else {
            console.log(`[YOUTUBE-CRON] ${c.full_name}: coleta disparada`);
          }
        } catch (err) {
          console.error(
            `[YOUTUBE-CRON] dispatch falhou ${c.full_name}:`,
            (err as Error).message,
          );
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      await supabase.rpc("record_collector_call", { _name: "youtube", _items: 0, _had_error: false });
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(dispatchJob);
    } else {
      await dispatchJob;
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
