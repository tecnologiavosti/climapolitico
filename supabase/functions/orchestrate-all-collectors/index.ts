// Edge function: orquestrador que dispara coletas em todas as redes para todos os candidatos.
// Chamado pelo pg_cron a cada 6h. Inclui retry automático de resolução de @handle do TikTok.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COLLECTORS: Array<{ name: string; fn: string; payload: (c: any) => Record<string, any> }> = [
  { name: "YouTube",      fn: "search-youtube-mentions",  payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Invidious",    fn: "invidious-collector",      payload: (c) => ({ candidateId: c.id }) },
  { name: "Google News",  fn: "google-news-collector",    payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "TikTok",       fn: "tiktok-collector",         payload: (c) => ({ candidateId: c.id }) },
  { name: "Reddit",       fn: "search-reddit-mentions",   payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Telegram",     fn: "search-telegram-mentions", payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Wikipedia",    fn: "wikipedia-deep-collector", payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Twitter/X",    fn: "search-twitter-mentions",  payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Bluesky",      fn: "bluesky-deep-collector",   payload: (c) => ({ candidateId: c.id, maxPosts: 600 }) },
  { name: "Mastodon",     fn: "mastodon-fediverse-collector", payload: (c) => ({ candidateId: c.id }) },
  { name: "Lemmy",        fn: "lemmy-fediverse-collector", payload: (c) => ({ candidateId: c.id }) },
  { name: "4chan",        fn: "fourchan-collector",       payload: (c) => ({ candidateId: c.id }) },
  { name: "Tumblr",       fn: "tumblr-collector",         payload: (c) => ({ candidateId: c.id }) },
  { name: "LinkedIn",     fn: "linkedin-collector",       payload: (c) => ({ candidateId: c.id }) },
  { name: "GDELT",        fn: "gdelt-collector",          payload: (c) => ({ candidateId: c.id, candidateName: c.full_name }) },
  { name: "Brand24",      fn: "collect-brand24-rss",      payload: (c) => ({ candidateId: c.id }) },
  { name: "Pinterest",    fn: "pinterest-collector",      payload: (c) => ({ candidateId: c.id }) },
  { name: "Facebook RSS", fn: "facebook-rss-collector",   payload: (c) => ({ candidateId: c.id }) },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const startedAt = Date.now();
  try {
    const reqBody = await req.json().catch(() => ({}));
    const requestedCollector = typeof reqBody.collector === "string" ? reqBody.collector.toLowerCase() : "all";
    const selectedCollectors = requestedCollector === "all"
      ? COLLECTORS
      : COLLECTORS.filter((c) => c.name.toLowerCase() === requestedCollector || c.fn.toLowerCase() === requestedCollector);

    if (selectedCollectors.length === 0) {
      return new Response(JSON.stringify({ error: `Coletor inválido: ${reqBody.collector}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
    console.log(`[ORCHESTRATOR] ${list.length} candidatos | ${selectedCollectors.length} coletores (${requestedCollector})`);

    const job = (async () => {
      const summary: Record<string, { ok: number; fail: number }> = {};
      for (const c of list) {
        for (const col of selectedCollectors) {
          summary[col.name] = summary[col.name] || { ok: 0, fail: 0 };

          // Quota check por coletor
          const quotaName = col.name.toLowerCase().replace("/x", "").replace(" ", "_");
          try {
            const { data: skipData } = await supabase.rpc("should_skip_collector", { _name: quotaName });
            if (skipData === true) {
              console.log(`[ORCHESTRATOR] ${col.name} pulado por quota`);
              continue;
            }
          } catch (_) { /* segue */ }

          try {
            const body = col.fn === "search-twitter-mentions" || col.fn === "search-youtube-mentions"
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
          await new Promise((r) => setTimeout(r, 800));
        }
      }
      console.log(`[ORCHESTRATOR] Concluído em ${(Date.now() - startedAt) / 1000}s | summary=`, JSON.stringify(summary));

      // Registra calls em quota
      for (const col of selectedCollectors) {
        const quotaName = col.name.toLowerCase().replace("/x", "").replace(" ", "_");
        const s = summary[col.name] || { ok: 0, fail: 0 };
        try {
          await supabase.rpc("record_collector_call", {
            _name: quotaName, _items: s.ok, _had_error: s.fail > 0,
          });
        } catch (_) { /* ignora */ }
      }

      // 3) Classifica regiões das novas interações (heurística + IA em lote)
      try {
        for (let i = 0; i < 5; i++) {
          const { data: cr } = await supabase.functions.invoke("classify-region", { body: { limit: 300 } });
          console.log(`[ORCHESTRATOR] classify-region pass ${i + 1}:`, JSON.stringify(cr));
          if (!cr || (cr as any).processed === 0) break;
        }
      } catch (e) {
        console.warn("[ORCHESTRATOR] classify-region falhou:", (e as Error).message);
      }
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
      collectors: selectedCollectors.map((c) => c.name),
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
