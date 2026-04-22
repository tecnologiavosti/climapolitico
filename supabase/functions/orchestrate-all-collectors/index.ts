// Edge function: orquestrador que dispara coletas em todas as redes para todos os candidatos.
// Chamado pelo pg_cron a cada 6h. Inclui retry automático de resolução de @handle do TikTok.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLLECTORS: Array<{ name: string; fn: string; payload: (c: any) => Record<string, any> }> = [
  { name: "YouTube",      fn: "search-youtube-mentions",  payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Google News",  fn: "google-news-collector",    payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "TikTok",       fn: "tiktok-collector",         payload: (c) => ({ candidateId: c.id }) },
  { name: "Reddit",       fn: "search-reddit-mentions",   payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Telegram",     fn: "search-telegram-mentions", payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Wikipedia",    fn: "search-wikipedia",         payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Twitter/X",    fn: "search-twitter-mentions",  payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // 1) Reagenda resolução de @handles TikTok pendentes (não bloqueante)
    try {
      await supabase.functions.invoke("tiktok-resolve-batch", { body: { force: false } });
      console.log("[ORCHESTRATOR] tiktok-resolve-batch disparado");
    } catch (e) {
      console.warn("[ORCHESTRATOR] tiktok-resolve-batch falhou:", (e as Error).message);
    }

    // 2) Lista candidatos ativos
    const { data: candidates, error } = await supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active")
      .limit(500);
    if (error) throw error;

    const list = candidates || [];
    console.log(`[ORCHESTRATOR] ${list.length} candidatos | ${COLLECTORS.length} coletores`);

    const job = (async () => {
      const summary: Record<string, { ok: number; fail: number }> = {};
      for (const c of list) {
        for (const col of COLLECTORS) {
          summary[col.name] = summary[col.name] || { ok: 0, fail: 0 };
          try {
            // Para search-twitter-mentions, precisamos passar userId pois ele exige (cron interno)
            const body = col.fn === "search-twitter-mentions"
              ? { ...col.payload(c), userId: c.user_id }
              : col.payload(c);
            const { error: invErr } = await supabase.functions.invoke(col.fn, { body });
            if (invErr) {
              summary[col.name].fail++;
              console.warn(`[ORCHESTRATOR] ${col.name} ${c.full_name}: ${invErr.message}`);
            } else {
              summary[col.name].ok++;
            }
          } catch (e) {
            summary[col.name].fail++;
            console.warn(`[ORCHESTRATOR] ${col.name} ${c.full_name} exception:`, (e as Error).message);
          }
          // Pacing leve para evitar rate-limits
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      console.log(`[ORCHESTRATOR] Concluído em ${(Date.now() - startedAt) / 1000}s | summary=`, JSON.stringify(summary));
    })();

    // @ts-ignore EdgeRuntime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(job);
    }

    return new Response(JSON.stringify({
      success: true,
      accepted: true,
      candidates: list.length,
      collectors: COLLECTORS.map((c) => c.name),
      message: "Orquestração iniciada em background",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[ORCHESTRATOR] erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
