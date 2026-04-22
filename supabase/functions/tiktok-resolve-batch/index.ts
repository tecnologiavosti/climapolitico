// Fila em lote para resolver handles do TikTok de vários candidatos sequencialmente.
// Roda em background (EdgeRuntime.waitUntil) para evitar timeout do request HTTP.
// Aplica rate-limit entre candidatos para evitar bloqueios do Firecrawl/Tikwm.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DELAY_BETWEEN_CANDIDATES_MS = 2500; // ~24 candidatos/min — abaixo de qualquer rate-limit
const MAX_BATCH_SIZE = 100;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claimsData.claims.sub;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const { onlyMissing = true, candidateIds } = body as {
      onlyMissing?: boolean;
      candidateIds?: string[];
    };

    // Buscar candidatos do usuário
    let query = supabase
      .from("candidates")
      .select("id, full_name, social_media_link")
      .eq("user_id", userId)
      .eq("status", "active");

    if (Array.isArray(candidateIds) && candidateIds.length > 0) {
      query = query.in("id", candidateIds.slice(0, MAX_BATCH_SIZE));
    }

    const { data: candidates, error } = await query;
    if (error) throw error;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ ok: true, queued: 0, message: "Nenhum candidato encontrado" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filtrar: somente os que NÃO têm @handle válido no link
    const targets = onlyMissing
      ? candidates.filter((c) => {
          const link = c.social_media_link || "";
          const m = link.match(/tiktok\.com\/@([A-Za-z0-9_.]+)/i);
          return !m?.[1];
        })
      : candidates;

    if (targets.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, queued: 0, total: candidates.length, message: "Todos já têm @handle do TikTok" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const limited = targets.slice(0, MAX_BATCH_SIZE);

    // Job em background — sequencial com delay
    const job = (async () => {
      let resolved = 0;
      let failed = 0;
      console.log(`[tiktok-resolve-batch] iniciando fila para ${limited.length} candidatos (user=${userId})`);
      for (const c of limited) {
        try {
          const { data, error } = await supabase.functions.invoke("tiktok-resolve-handle", {
            body: { candidateId: c.id, autoSave: true },
          });
          if (error) {
            failed++;
            console.warn(`[tiktok-resolve-batch] ${c.full_name}: erro ${error.message}`);
          } else if (data?.handle) {
            resolved++;
            console.log(`[tiktok-resolve-batch] ${c.full_name} → @${data.handle}`);
          } else {
            failed++;
            console.log(`[tiktok-resolve-batch] ${c.full_name}: sem handle (${data?.reason || "?"})`);
          }
        } catch (e) {
          failed++;
          console.error(`[tiktok-resolve-batch] ${c.full_name}: exceção`, e instanceof Error ? e.message : e);
        }
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CANDIDATES_MS));
      }
      console.log(`[tiktok-resolve-batch] fila finalizada: ${resolved} resolvidos, ${failed} falharam`);

      // Notificação ao usuário
      try {
        await supabase.from("notifications").insert({
          user_id: userId,
          title: "Resolução de @handles do TikTok concluída",
          message: `${resolved} candidatos tiveram o @handle do TikTok descoberto e salvo. ${failed} não puderam ser resolvidos automaticamente.`,
          type: "system",
          severity: resolved > 0 ? "success" : "warning",
          metadata: { resolved, failed, total: limited.length },
        });
      } catch (e) {
        console.warn("[tiktok-resolve-batch] falha ao criar notificação:", e instanceof Error ? e.message : e);
      }
    })();

    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(job);

    return new Response(
      JSON.stringify({
        ok: true,
        queued: limited.length,
        total: candidates.length,
        skipped: candidates.length - targets.length,
        estimatedMinutes: Math.ceil((limited.length * DELAY_BETWEEN_CANDIDATES_MS) / 60000),
        message: `Fila iniciada em background. Você receberá uma notificação ao terminar.`,
      }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[tiktok-resolve-batch] erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
