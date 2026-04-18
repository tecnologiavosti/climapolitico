SELECT cron.schedule(
  'reddit-cron-scraper-every-10-min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/reddit-cron-scraper',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);