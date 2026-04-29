-- Agenda recálculo automático do cache de métricas a cada 10 minutos
-- para manter Visão Geral (total de menções, sentimento, engajamento) sempre atualizado
-- conforme as coletas de redes sociais vão chegando.

SELECT cron.unschedule('recalculate-metrics-cron-10min')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recalculate-metrics-cron-10min');

SELECT cron.schedule(
  'recalculate-metrics-cron-10min',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/recalculate-metrics-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Dispara uma vez agora para atualizar imediatamente
SELECT net.http_post(
  url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/recalculate-metrics-cron',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
  ),
  body := '{}'::jsonb
);