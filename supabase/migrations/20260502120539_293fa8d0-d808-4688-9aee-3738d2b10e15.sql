-- Garante extensões
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Remove agendamento anterior, se existir
DO $$
BEGIN
  PERFORM cron.unschedule('linkedin-collector-30min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Agendamento a cada 30 minutos (offset :07 para não colidir com outros jobs)
SELECT cron.schedule(
  'linkedin-collector-30min',
  '7,37 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://okazmxhoviblxtxtjzzc.supabase.co/functions/v1/linkedin-collector',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := jsonb_build_object('triggered_by', 'cron', 'time', now())
  ) AS request_id;
  $$
);

-- Inicializa estado de quota para o coletor
INSERT INTO public.collector_quota_state (collector_name, max_daily_calls, notes)
VALUES ('linkedin-collector', 96, 'LinkedIn via Google News RSS — 48 execuções/dia + folga')
ON CONFLICT (collector_name) DO NOTHING;