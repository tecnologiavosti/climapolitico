
-- ============================================================
-- Guia Supremo 40K — agenda swarm de coletores
-- Todos os jobs chamam o orquestrador filtrando por coletor,
-- aproveitando quota, retry e iteração de candidatos existentes.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Helper: agenda (ou re-agenda) job que invoca o orquestrador para um coletor
DO $do$
DECLARE
  jobs jsonb := '[
    {"name":"swarm-youtube-5min",       "schedule":"*/5 * * * *",   "collector":"YouTube"},
    {"name":"swarm-twitter-5min",       "schedule":"*/5 * * * *",   "collector":"Twitter/X"},
    {"name":"swarm-reddit-5min",        "schedule":"*/5 * * * *",   "collector":"Reddit"},

    {"name":"swarm-meta-15min",         "schedule":"*/15 * * * *",  "collector":"meta-mass-collector"},
    {"name":"swarm-tiktok-15min",       "schedule":"2,17,32,47 * * * *", "collector":"TikTok"},
    {"name":"swarm-facebook-rss-15min", "schedule":"4,19,34,49 * * * *", "collector":"Facebook RSS"},

    {"name":"swarm-telegram-30min",     "schedule":"6,36 * * * *",  "collector":"Telegram"},
    {"name":"swarm-linkedin-30min",     "schedule":"8,38 * * * *",  "collector":"LinkedIn"},
    {"name":"swarm-pinterest-30min",    "schedule":"10,40 * * * *", "collector":"Pinterest"},
    {"name":"swarm-googlenews-30min",   "schedule":"12,42 * * * *", "collector":"Google News"},
    {"name":"swarm-gdelt-30min",        "schedule":"14,44 * * * *", "collector":"GDELT"},

    {"name":"swarm-bluesky-1h",         "schedule":"16 * * * *",    "collector":"Bluesky"},
    {"name":"swarm-mastodon-1h",        "schedule":"18 * * * *",    "collector":"Mastodon"},
    {"name":"swarm-lemmy-1h",           "schedule":"20 * * * *",    "collector":"Lemmy"},
    {"name":"swarm-fourchan-1h",        "schedule":"22 * * * *",    "collector":"4chan"},
    {"name":"swarm-tumblr-1h",          "schedule":"24 * * * *",    "collector":"Tumblr"},
    {"name":"swarm-wikipedia-1h",       "schedule":"26 * * * *",    "collector":"Wikipedia"},
    {"name":"swarm-invidious-1h",       "schedule":"28 * * * *",    "collector":"Invidious"},
    {"name":"swarm-brand24-1h",         "schedule":"30 * * * *",    "collector":"Brand24"}
  ]'::jsonb;
  j jsonb;
  cmd text;
BEGIN
  FOR j IN SELECT * FROM jsonb_array_elements(jobs) LOOP
    -- desagenda se existir
    PERFORM cron.unschedule((j->>'name'))
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = (j->>'name'));

    cmd := format(
      $cron$
      SELECT net.http_post(
        url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/orchestrate-all-collectors',
        headers := jsonb_build_object(
          'Content-Type','application/json',
          'Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
        ),
        body := jsonb_build_object('collector', %L, 'triggered_by','cron')
      );
      $cron$, j->>'collector'
    );

    PERFORM cron.schedule(j->>'name', j->>'schedule', cmd);
  END LOOP;
END
$do$;

-- ============================================================
-- Aumenta limites diários de quota para suportar swarm
-- ============================================================
INSERT INTO public.collector_quota_state (collector_name, max_daily_calls, notes) VALUES
  ('youtube',         50000, 'Swarm 5min — guia 40K'),
  ('twitter',         20000, 'Swarm 5min via Nitter — guia 40K'),
  ('reddit',          20000, 'Swarm 5min — guia 40K'),
  ('meta-mass-collector', 5000, 'Swarm 15min Apify Meta'),
  ('tiktok',          10000, 'Swarm 15min ProxiTok'),
  ('facebook_rss',    5000,  'Swarm 15min RSS-Bridge'),
  ('telegram',        5000,  'Swarm 30min'),
  ('linkedin',        5000,  'Swarm 30min Google News RSS'),
  ('pinterest',       3000,  'Swarm 30min'),
  ('google_news',     5000,  'Swarm 30min'),
  ('gdelt',           5000,  'Swarm 30min')
ON CONFLICT (collector_name) DO UPDATE
  SET max_daily_calls = GREATEST(public.collector_quota_state.max_daily_calls, EXCLUDED.max_daily_calls),
      notes = EXCLUDED.notes,
      updated_at = now();
