import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TopPostsSchema = z.object({
  candidateId: z.string().uuid().nullable().optional(),
  network: z.string().min(1).max(40).nullable().optional(),
  days: z.number().int().min(1).max(3650).default(30),
});

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const started = performance.now();
  try {
    if (req.method !== "POST") {
      return json({ ok: false, error: "Método não permitido." }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader ?? "" } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return json({ ok: false, error: "Sessão expirada." }, 401);
    }

    const parsed = TopPostsSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return json({ ok: false, error: parsed.error.flatten().fieldErrors }, 400);
    }

    const { candidateId, network, days } = parsed.data;
    const { data, error } = await supabase.rpc("network_view_top_posts", {
      p_candidate_id: candidateId ?? null,
      p_network: network && network !== "all" ? network : null,
      p_days: days,
    });

    if (error) throw error;

    const durationMs = Math.round(performance.now() - started);
    if (durationMs > 2000) {
      console.warn("[social/top-posts] consulta lenta", { durationMs, userId: user.id, candidateId, network, days });
    } else {
      console.info("[social/top-posts] carregado", { durationMs, userId: user.id, candidateId, network, days });
    }

    return json({ ...(data as Record<string, unknown>), page_duration_ms: durationMs });
  } catch (error) {
    console.error("[social/top-posts] erro", error);
    return json({ ok: false, error: "Não foi possível carregar os top posts." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}