import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SYSTEM_VARS = new Set([
  "PATH", "HOME", "DENO_DIR", "HOSTNAME", "PORT", "TMPDIR",
  "USER", "LANG", "TERM", "_", "DENO_REGION", "DENO_DEPLOYMENT_ID",
]);

const knownFunctionNames = ["admin-update-user-temp","admin-user-actions","ai-candidate-comparison","analyze-candidate","analyze-event-regional","analyze-event-repercussion","analyze-rejection","analyze-sentiment","analyze-speech","analyze-speeches-temporal","analyze-undecided","apify-poll-runs","auto-detect-events","backfill-replies","bluesky-deep-collector","bulk-backfill-sentiment","calculate-opportunity-map","calculate-ranking","catalog-search-hybrid","chat-event-region","classify-political-figure","classify-region","cleanup-worker","cluster-political-events","collect-brand24-rss","collect-social-comments","deduplicate-profiles","detect-candidate-events","detect-events-from-news","detect-historical-peaks","detect-narrative-spikes","discover-social-links","enrich-interactions-location","etl-tse-politicians","export-worker","external-worker-api","facebook-rss-collector","fourchan-collector","gdelt-collector","generate-blog-posts","generate-candidate-summary","generate-disinformation-radar","generate-insights","generate-narrative-recommendations","generate-rejection-comments","get-state-details","google-news-collector","historical-comparison","historical-news-backfill","historical-social-collector","invidious-collector","lemmy-fediverse-collector","linkedin-collector","lookup-candidate-ai","mastodon-fediverse-collector","meta-mass-collector","migrate-sql","network-listening","network-qualitative-analysis","orchestrate-all-collectors","painel-migracao","pinterest-collector","political-intelligence","public-api-v1","queue-scheduler","radar-ai-search","radar-job-create","radar-job-status","reanalyze-sentiment","recalculate-candidate-metrics","recalculate-metrics-cron","reddit-cron-scraper","refresh-trending-candidates","regional-ai-analysis","regional-insights","resolve-peak-cause","run-event-pipeline","search-google-news","search-politicians-ai","search-reddit-mentions","search-telegram-mentions","search-twitter-mentions","search-wikipedia","search-youtube-mentions","send-2fa-code","send-password-reset","sentiment-cron-refine","sentiment-sanity-test","sentiment-worker","signup-user","social","social-political-crawler","suggest-candidate-config","tiktok-collector","tiktok-resolve-batch","tiktok-resolve-handle","tse-search","tumblr-collector","twitter-nitter-scraper","validate-api-key","validate-event","verify-2fa-code","verify-password-reset","webhook-dispatcher","wikipedia-deep-collector","youtube-cron-scraper"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const env = Deno.env.toObject();
    const SUPABASE_URL = env.SUPABASE_URL ?? "";
    const anon = env.SUPABASE_ANON_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? "";
    const service = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

    // Extra secrets (excluding system + supabase-standard ones)
    const excluded = new Set([
      ...SYSTEM_VARS,
      "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_URL",
    ]);
    const extras: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      if (excluded.has(k)) continue;
      if (k.startsWith("XDG_")) continue;
      extras[k] = v;
    }

    // Probe edge functions
    let edgeFunctions: string[] = [];
    if (SUPABASE_URL) {
      const probes = await Promise.allSettled(
        knownFunctionNames.map(async (name) => {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
            method: "OPTIONS",
          });
          return { name, ok: res.status < 500 };
        }),
      );
      edgeFunctions = probes
        .filter((p) => p.status === "fulfilled" && p.value.ok)
        .map((p: any) => p.value.name);
    }

    // Query database tables via exec_sql
    let databaseTables: unknown = [];
    if (SUPABASE_URL && service) {
      try {
        const supabase = createClient(SUPABASE_URL, service);
        const sql = `
          SELECT
            t.tablename,
            COALESCE((SELECT reltuples::bigint FROM pg_class WHERE oid = (t.schemaname || '.' || t.tablename)::regclass), 0) AS row_count,
            (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = t.schemaname AND c.table_name = t.tablename) AS column_count,
            (SELECT count(*) FROM information_schema.columns c WHERE c.table_schema = t.schemaname AND c.table_name = t.tablename AND c.column_name ILIKE '%encrypted%') AS encrypted_columns,
            EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = t.schemaname AND c.table_name = t.tablename AND c.column_name = 'user_id') AS has_user_id
          FROM pg_tables t
          WHERE t.schemaname = 'public'
          ORDER BY t.tablename
        `;
        const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql });
        if (!error) databaseTables = data ?? [];
      } catch (_e) {
        // ignore
      }
    }

    const payload = {
      project_url: SUPABASE_URL,
      anon_key: anon,
      service_role_key: service,
      secrets: extras,
      edge_functions: edgeFunctions,
      edge_functions_count: edgeFunctions.length,
      database_tables: databaseTables,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
