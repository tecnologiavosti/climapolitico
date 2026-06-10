// Edge function: orquestrador de coleta.
// L1 refactor: paralelização com Promise.allSettled + concurrency limit,
// retry exponencial (429/503/timeout), quota check 1x por coletor,
// tarefas pesadas (reprocess/classify-region/apify-poll/meta-mass/tiktok-resolve)
// movidas para cron próprio.

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
  // F6: Brand24 removido — 22/22 falhas em 24h, token inválido. Pausado por 30d em collector_quota_state.
  // { name: "Brand24",      fn: "collect-brand24-rss",      payload: (c) => ({ candidateId: c.id }) },
  { name: "Pinterest",    fn: "pinterest-collector",      payload: (c) => ({ candidateId: c.id }) },
  { name: "Facebook RSS", fn: "facebook-rss-collector",   payload: (c) => ({ candidateId: c.id }) },
];

const CANDIDATE_CONCURRENCY = 5;
const COLLECTOR_CONCURRENCY = 5;
const RETRY_BACKOFFS_MS = [1000, 3000, 9000]; // tentativas 1, 2, 3

// Concurrency limiter (sem dependência externa)
async function pMapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i]); }
      catch (e) { results[i] = e as any; }
    }
  });
  await Promise.all(workers);
  return results;
}

// Retry exponencial para 429/503/timeout
function isRetryableError(msg: string): boolean {
  const s = msg.toLowerCase();
  return s.includes("429") || s.includes("503") || s.includes("timeout") ||
         s.includes("timed out") || s.includes("rate limit") || s.includes("unavailable");
}

async function invokeWithRetry(
  supabase: any, fn: string, body: any,
): Promise<{ ok: boolean; error?: string; attempts: number }> {
  let lastErr = "";
  for (let attempt = 0; attempt <= RETRY_BACKOFFS_MS.length; attempt++) {
    try {
      const { error } = await supabase.functions.invoke(fn, { body });
      if (!error) return { ok: true, attempts: attempt + 1 };
      lastErr = error.message || String(error);
      if (!isRetryableError(lastErr) || attempt === RETRY_BACKOFFS_MS.length) {
        return { ok: false, error: lastErr, attempts: attempt + 1 };
      }
    } catch (e) {
      lastErr = (e as Error).message;
      if (!isRetryableError(lastErr) || attempt === RETRY_BACKOFFS_MS.length) {
        return { ok: false, error: lastErr, attempts: attempt + 1 };
      }
    }
    await new Promise((r) => setTimeout(r, RETRY_BACKOFFS_MS[attempt]));
  }
  return { ok: false, error: lastErr, attempts: RETRY_BACKOFFS_MS.length + 1 };
}

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

    const candidatesQuery = supabase
      .from("candidates")
      .select("id, full_name, user_id")
      .eq("status", "active")
      .limit(500);
    const { data: candidates, error } = reqBody.candidateId
      ? await candidatesQuery.eq("id", reqBody.candidateId)
      : await candidatesQuery;
    if (error) throw error;

    const list = candidates || [];
    console.log(`[ORCHESTRATOR] ${list.length} candidatos | ${selectedCollectors.length} coletores (${requestedCollector})`);

    const job = (async () => {
      // QUOTA CHECK: 1x por coletor (não por candidato)
      const quotaSkip: Record<string, boolean> = {};
      await Promise.allSettled(selectedCollectors.map(async (col) => {
        const quotaName = col.name.toLowerCase().replace("/x", "").replace(" ", "_");
        try {
          const { data: skip } = await supabase.rpc("should_skip_collector", { _name: quotaName });
          quotaSkip[col.name] = skip === true;
          if (skip === true) console.log(`[ORCHESTRATOR] ${col.name} pulado por quota`);
        } catch (_) { quotaSkip[col.name] = false; }
      }));

      const activeCollectors = selectedCollectors.filter((c) => !quotaSkip[c.name]);
      const summary: Record<string, { ok: number; fail: number; retries: number }> = {};
      for (const col of activeCollectors) summary[col.name] = { ok: 0, fail: 0, retries: 0 };

      // PARALELIZAÇÃO: candidatos em paralelo (CANDIDATE_CONCURRENCY),
      // dentro de cada candidato coletores em paralelo (COLLECTOR_CONCURRENCY).
      await pMapLimit(list, CANDIDATE_CONCURRENCY, async (c) => {
        await pMapLimit(activeCollectors, COLLECTOR_CONCURRENCY, async (col) => {
          const body = col.fn === "search-twitter-mentions" || col.fn === "search-youtube-mentions"
            ? { ...col.payload(c), userId: c.user_id }
            : col.payload(c);
          const res = await invokeWithRetry(supabase, col.fn, body);
          if (res.ok) summary[col.name].ok++;
          else {
            summary[col.name].fail++;
            console.warn(`[ORCHESTRATOR] ${col.name} ${c.full_name} (${res.attempts}t): ${res.error}`);
          }
          if (res.attempts > 1) summary[col.name].retries += res.attempts - 1;
        });
      });

      const elapsedSec = (Date.now() - startedAt) / 1000;
      console.log(`[ORCHESTRATOR] Concluído em ${elapsedSec}s | summary=`, JSON.stringify(summary));

      // Registra calls em quota (apenas para os ativos)
      await Promise.allSettled(activeCollectors.map(async (col) => {
        const quotaName = col.name.toLowerCase().replace("/x", "").replace(" ", "_");
        const s = summary[col.name];
        const hadError = s.ok === 0 && s.fail > 0;
        try {
          await supabase.rpc("record_collector_call", {
            _name: quotaName, _items: s.ok, _had_error: hadError,
          });
        } catch (_) { /* ignora */ }
      }));
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
      concurrency: { candidates: CANDIDATE_CONCURRENCY, collectors: COLLECTOR_CONCURRENCY },
      message: "Orquestração iniciada em background (paralelo)",
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro desconhecido";
    console.error("[ORCHESTRATOR] erro fatal:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
