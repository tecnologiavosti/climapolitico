-- 1. Normalizar dados existentes do social_network
UPDATE public.social_interactions SET social_network = lower(social_network) WHERE social_network <> lower(social_network);

-- 2. Trigger BEFORE INSERT/UPDATE para garantir lower()
CREATE OR REPLACE FUNCTION public.normalize_social_network()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.social_network IS NOT NULL THEN
    NEW.social_network := lower(NEW.social_network);
    -- Aliases comuns
    IF NEW.social_network IN ('twitter/x', 'x', 'twitter_x') THEN
      NEW.social_network := 'twitter';
    END IF;
    IF NEW.social_network IN ('google news', 'google_news', 'googlenews', 'news') THEN
      NEW.social_network := 'google_news';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_social_network ON public.social_interactions;
CREATE TRIGGER trg_normalize_social_network
BEFORE INSERT OR UPDATE ON public.social_interactions
FOR EACH ROW EXECUTE FUNCTION public.normalize_social_network();

-- Re-normalizar após criação de função (caso aliases adicionais tenham sobrado)
UPDATE public.social_interactions SET social_network = 'twitter' WHERE social_network IN ('twitter/x', 'x');

-- 3. Reduzir tempo de reativação YouTube para 6h
CREATE OR REPLACE FUNCTION public.reactivate_youtube_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.youtube_api_keys
  SET is_active = true,
      quota_exceeded_count = 0
  WHERE is_active = false
    AND last_quota_exceeded_at < now() - interval '6 hours';
$$;

-- 4. Cron para classify-region a cada 15min
SELECT cron.unschedule('classify-region-15min') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='classify-region-15min');
SELECT cron.schedule(
  'classify-region-15min',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/classify-region',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
  $cron$
);

-- 5. Reforço Meta (Instagram/Facebook) — 2x por dia
SELECT cron.unschedule('meta-mass-collector-morning') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='meta-mass-collector-morning');
SELECT cron.schedule(
  'meta-mass-collector-morning',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/meta-mass-collector',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
  $cron$
);
SELECT cron.unschedule('meta-mass-collector-evening') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='meta-mass-collector-evening');
SELECT cron.schedule(
  'meta-mass-collector-evening',
  '0 22 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/meta-mass-collector',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)),
    body := '{}'::jsonb
  );
  $cron$
);