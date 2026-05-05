
-- Aumentar frequência dos coletores de maior rendimento para atingir ~40k menções/dia
-- Estratégia: encurtar intervalos dos swarms de alto volume e elevar quotas

-- 1) Reagendar swarms de alto rendimento (unschedule + schedule)
DO $$
DECLARE
  service_key text;
  url_base text := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/orchestrate-all-collectors';
  jobs text[] := ARRAY[
    'swarm-youtube-5min','swarm-facebook-rss-15min','swarm-tiktok-15min',
    'swarm-telegram-30min','swarm-googlenews-30min','swarm-mastodon-1h',
    'swarm-lemmy-1h','swarm-pinterest-30min','swarm-linkedin-30min',
    'swarm-bluesky-1h','swarm-invidious-1h','swarm-tumblr-1h',
    'swarm-wikipedia-1h','swarm-fourchan-1h','swarm-brand24-1h',
    'swarm-gdelt-30min'
  ];
  j text;
BEGIN
  SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1;

  FOREACH j IN ARRAY jobs LOOP
    BEGIN
      PERFORM cron.unschedule(j);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- ALTA FREQUÊNCIA (alto rendimento)
  PERFORM cron.schedule('swarm-youtube-2min', '*/2 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','YouTube','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-facebook-rss-5min', '*/5 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Facebook RSS','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-tiktok-5min', '*/5 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','TikTok','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-telegram-10min', '*/10 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Telegram','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-googlenews-10min', '*/10 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Google News','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-lemmy-20min', '3,23,43 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Lemmy','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-mastodon-20min', '5,25,45 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Mastodon','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-pinterest-20min', '7,27,47 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Pinterest','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-linkedin-20min', '9,29,49 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','LinkedIn','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-bluesky-30min', '11,41 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Bluesky','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-invidious-30min', '13,43 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Invidious','triggered_by','cron'));$f$, url_base, service_key));

  -- Restantes (rendimento baixo, mantém 1h)
  PERFORM cron.schedule('swarm-tumblr-1h', '24 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Tumblr','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-wikipedia-1h', '26 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Wikipedia','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-fourchan-1h', '22 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','4chan','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-brand24-1h', '30 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','Brand24','triggered_by','cron'));$f$, url_base, service_key));

  PERFORM cron.schedule('swarm-gdelt-1h', '32 * * * *',
    format($f$SELECT net.http_post(url:=%L, headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'), body:=jsonb_build_object('collector','GDELT','triggered_by','cron'));$f$, url_base, service_key));
END $$;

-- 2) Elevar quotas para suportar a nova cadência
UPDATE public.collector_quota_state SET max_daily_calls = GREATEST(max_daily_calls, 200000) WHERE collector_name IN ('youtube','twitter');
UPDATE public.collector_quota_state SET max_daily_calls = GREATEST(max_daily_calls, 100000) WHERE collector_name IN ('facebook_rss','tiktok','telegram','google_news','reddit','meta-mass-collector');
UPDATE public.collector_quota_state SET max_daily_calls = GREATEST(max_daily_calls, 50000) WHERE collector_name IN ('lemmy','mastodon','pinterest','linkedin','bluesky','invidious','tumblr','wikipedia','4chan','brand24','gdelt');
