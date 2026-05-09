
-- ============================================================================
-- ONDA 2: Cache, Exports, Realtime, Indexes
-- ============================================================================

-- 1. Cache L2: deduplicação de análises por hash do texto
CREATE TABLE IF NOT EXISTS public.analysis_cache (
  cache_key text PRIMARY KEY,           -- sha256(comment_text)
  analysis_type text NOT NULL DEFAULT 'sentiment',
  result jsonb NOT NULL,
  provider text,
  hit_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_hit_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON public.analysis_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_analysis_cache_type ON public.analysis_cache (analysis_type, last_hit_at DESC);
ALTER TABLE public.analysis_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read cache" ON public.analysis_cache FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 2. Export jobs (assíncrono)
CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  export_type text NOT NULL,            -- csv|xlsx|pdf|json
  resource text NOT NULL,               -- candidates|interactions|rankings|...
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  progress smallint NOT NULL DEFAULT 0,
  storage_path text,
  download_url text,
  download_expires_at timestamptz,
  rows_exported integer,
  file_size_bytes bigint,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT export_status_chk CHECK (status IN ('queued','processing','succeeded','failed','expired')),
  CONSTRAINT export_type_chk CHECK (export_type IN ('csv','xlsx','pdf','json'))
);
CREATE INDEX IF NOT EXISTS idx_export_jobs_user ON public.export_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_export_jobs_pending ON public.export_jobs (status, created_at) WHERE status IN ('queued','processing');
ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own exports" ON public.export_jobs FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all exports" ON public.export_jobs FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 3. Rate limits (throttling por usuário/endpoint)
CREATE TABLE IF NOT EXISTS public.rate_limits (
  id bigserial PRIMARY KEY,
  identifier text NOT NULL,             -- user_id ou IP
  endpoint text NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  UNIQUE (identifier, endpoint, window_start)
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits (identifier, endpoint, window_start DESC);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read rate limits" ON public.rate_limits FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 4. Materialized view: métricas por hora
CREATE MATERIALIZED VIEW IF NOT EXISTS public.pipeline_metrics_hourly AS
SELECT
  date_trunc('hour', recorded_at) AS bucket,
  metric_name,
  count(*) AS samples,
  avg(metric_value) AS avg_value,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY metric_value) AS p50,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY metric_value) AS p95,
  percentile_cont(0.99) WITHIN GROUP (ORDER BY metric_value) AS p99,
  max(metric_value) AS max_value,
  sum(metric_value) AS sum_value
FROM public.pipeline_metrics
WHERE recorded_at > now() - interval '7 days'
GROUP BY 1, 2;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pmh_unique ON public.pipeline_metrics_hourly (bucket, metric_name);

CREATE OR REPLACE FUNCTION public.refresh_pipeline_metrics_hourly()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.pipeline_metrics_hourly;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_pipeline_metrics_hourly() FROM anon, authenticated;

-- Refresh a cada 5 minutos
SELECT cron.schedule('refresh-metrics-hourly','*/5 * * * *',
  $$ SELECT public.refresh_pipeline_metrics_hourly(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='refresh-metrics-hourly');

-- 5. Cache cleanup
CREATE OR REPLACE FUNCTION public.cleanup_analysis_cache()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v integer;
BEGIN
  WITH d AS (DELETE FROM public.analysis_cache WHERE expires_at < now() RETURNING 1)
  SELECT count(*) INTO v FROM d;
  RETURN COALESCE(v,0);
END; $$;
REVOKE EXECUTE ON FUNCTION public.cleanup_analysis_cache() FROM anon, authenticated;

SELECT cron.schedule('cleanup-analysis-cache','0 5 * * *',
  $$ SELECT public.cleanup_analysis_cache(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-analysis-cache');

-- 6. Rate limit helper
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _identifier text, _endpoint text, _max_per_minute integer DEFAULT 60
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  INSERT INTO public.rate_limits (identifier, endpoint, request_count, window_start)
  VALUES (_identifier, _endpoint, 1, v_window)
  ON CONFLICT (identifier, endpoint, window_start)
  DO UPDATE SET request_count = public.rate_limits.request_count + 1
  RETURNING request_count INTO v_count;
  RETURN v_count <= _max_per_minute;
END; $$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text,text,integer) FROM anon, authenticated;

-- Limpa rate_limits antigos
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 hour';
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_rate_limits() FROM anon, authenticated;

SELECT cron.schedule('cleanup-rate-limits','*/30 * * * *',
  $$ SELECT public.cleanup_rate_limits(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-rate-limits');

-- 7. Realtime habilitado para o Operations Console
ALTER PUBLICATION supabase_realtime ADD TABLE public.analysis_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.worker_heartbeats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.provider_health;
ALTER PUBLICATION supabase_realtime ADD TABLE public.export_jobs;
ALTER TABLE public.analysis_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.system_alerts REPLICA IDENTITY FULL;
ALTER TABLE public.worker_heartbeats REPLICA IDENTITY FULL;
ALTER TABLE public.provider_health REPLICA IDENTITY FULL;
ALTER TABLE public.export_jobs REPLICA IDENTITY FULL;

-- 8. Storage bucket privado para exports
INSERT INTO storage.buckets (id, name, public) VALUES ('exports','exports', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users read own exports"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='exports' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role writes exports"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='exports' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 9. Índices compostos adicionais para performance da fila
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_dead ON public.analysis_jobs (job_type, updated_at DESC) WHERE status='dead';
CREATE INDEX IF NOT EXISTS idx_social_interactions_unlabeled ON public.social_interactions (analysis_attempts, created_at)
  WHERE sentiment_label IS NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_low_conf ON public.social_interactions (sentiment_confidence)
  WHERE sentiment_label = 'Neutro' AND sentiment_confidence < 0.6;
