
-- ============================================================================
-- ENTERPRISE QUEUE ARCHITECTURE
-- ============================================================================

-- 1. Job queue
CREATE TABLE IF NOT EXISTS public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  priority smallint NOT NULL DEFAULT 5,
  attempts smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 5,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  leased_at timestamptz,
  lease_expires_at timestamptz,
  worker_id text,
  candidate_id uuid,
  user_id uuid,
  related_id uuid,
  last_error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT analysis_jobs_status_chk CHECK (status IN ('queued','leased','running','succeeded','failed','dead','cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_analysis_jobs_claim ON public.analysis_jobs (status, priority, scheduled_at) WHERE status IN ('queued','leased');
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_type ON public.analysis_jobs (job_type, status);
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_candidate ON public.analysis_jobs (candidate_id) WHERE candidate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analysis_jobs_lease ON public.analysis_jobs (lease_expires_at) WHERE status = 'leased';

ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage analysis_jobs" ON public.analysis_jobs FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_analysis_jobs_updated BEFORE UPDATE ON public.analysis_jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Job execution history
CREATE TABLE IF NOT EXISTS public.job_execution_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  worker_id text,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_job_history_job ON public.job_execution_history (job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_history_started ON public.job_execution_history (started_at DESC);
ALTER TABLE public.job_execution_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read job history" ON public.job_execution_history FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 3. Worker heartbeats
CREATE TABLE IF NOT EXISTS public.worker_heartbeats (
  worker_id text PRIMARY KEY,
  worker_type text NOT NULL,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  jobs_processed integer NOT NULL DEFAULT 0,
  jobs_failed integer NOT NULL DEFAULT 0,
  current_job_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON public.worker_heartbeats (last_heartbeat_at DESC);
ALTER TABLE public.worker_heartbeats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read workers" ON public.worker_heartbeats FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 4. Pipeline metrics (time-series, sampled)
CREATE TABLE IF NOT EXISTS public.pipeline_metrics (
  id bigserial PRIMARY KEY,
  metric_name text NOT NULL,
  metric_value numeric NOT NULL,
  labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_name_time ON public.pipeline_metrics (metric_name, recorded_at DESC);
ALTER TABLE public.pipeline_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read metrics" ON public.pipeline_metrics FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- 5. Provider health (circuit breaker state)
CREATE TABLE IF NOT EXISTS public.provider_health (
  provider text PRIMARY KEY,
  state text NOT NULL DEFAULT 'closed',
  consecutive_failures integer NOT NULL DEFAULT 0,
  consecutive_successes integer NOT NULL DEFAULT 0,
  total_calls bigint NOT NULL DEFAULT 0,
  total_failures bigint NOT NULL DEFAULT 0,
  avg_latency_ms numeric NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  cooldown_until timestamptz,
  health_score smallint NOT NULL DEFAULT 100,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_state_chk CHECK (state IN ('closed','open','half_open'))
);
ALTER TABLE public.provider_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage provider_health" ON public.provider_health FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.provider_health (provider) VALUES
  ('lovable'), ('groq'), ('cerebras'), ('gemini')
ON CONFLICT (provider) DO NOTHING;

-- 6. System alerts
CREATE TABLE IF NOT EXISTS public.system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alert_severity_chk CHECK (severity IN ('info','warning','error','critical'))
);
CREATE INDEX IF NOT EXISTS idx_system_alerts_unresolved ON public.system_alerts (created_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE public.system_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage alerts" ON public.system_alerts FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Atomic job leasing with SKIP LOCKED
CREATE OR REPLACE FUNCTION public.claim_jobs(
  _worker_id text,
  _job_type text,
  _batch_size integer DEFAULT 5,
  _lease_seconds integer DEFAULT 120
) RETURNS SETOF public.analysis_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT id FROM public.analysis_jobs
    WHERE job_type = _job_type
      AND status IN ('queued')
      AND scheduled_at <= now()
    ORDER BY priority ASC, scheduled_at ASC
    LIMIT _batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.analysis_jobs j
  SET status = 'leased',
      worker_id = _worker_id,
      leased_at = now(),
      lease_expires_at = now() + make_interval(secs => _lease_seconds),
      attempts = j.attempts + 1,
      updated_at = now()
  FROM picked
  WHERE j.id = picked.id
  RETURNING j.*;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.claim_jobs(text,text,integer,integer) FROM anon, authenticated;

-- Recover stuck jobs (lease expired)
CREATE OR REPLACE FUNCTION public.recover_stuck_jobs()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  WITH r AS (
    UPDATE public.analysis_jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END,
        worker_id = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        last_error = COALESCE(last_error,'') || ' [lease_expired]',
        scheduled_at = now() + make_interval(secs => LEAST(300, power(2, attempts)::int * 10)),
        updated_at = now()
    WHERE status = 'leased' AND lease_expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO v_count FROM r;
  IF v_count > 0 THEN
    INSERT INTO public.system_alerts (alert_type, severity, title, message, metadata)
    VALUES ('stuck_jobs','warning','Jobs travados recuperados',
            format('%s jobs com lease expirado foram recolocados na fila', v_count),
            jsonb_build_object('count', v_count));
  END IF;
  RETURN COALESCE(v_count,0);
END; $$;
REVOKE EXECUTE ON FUNCTION public.recover_stuck_jobs() FROM anon, authenticated;

-- Worker heartbeat
CREATE OR REPLACE FUNCTION public.record_worker_heartbeat(
  _worker_id text, _worker_type text, _current_job_id uuid DEFAULT NULL,
  _processed_delta integer DEFAULT 0, _failed_delta integer DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.worker_heartbeats (worker_id, worker_type, current_job_id, jobs_processed, jobs_failed)
  VALUES (_worker_id, _worker_type, _current_job_id, GREATEST(_processed_delta,0), GREATEST(_failed_delta,0))
  ON CONFLICT (worker_id) DO UPDATE SET
    last_heartbeat_at = now(),
    worker_type = EXCLUDED.worker_type,
    current_job_id = EXCLUDED.current_job_id,
    jobs_processed = public.worker_heartbeats.jobs_processed + _processed_delta,
    jobs_failed = public.worker_heartbeats.jobs_failed + _failed_delta;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_worker_heartbeat(text,text,uuid,integer,integer) FROM anon, authenticated;

-- Provider health update + circuit breaker
CREATE OR REPLACE FUNCTION public.record_provider_call(
  _provider text, _success boolean, _latency_ms integer DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_state text; v_fails integer; v_succ integer;
BEGIN
  INSERT INTO public.provider_health (provider) VALUES (_provider)
    ON CONFLICT (provider) DO NOTHING;

  IF _success THEN
    UPDATE public.provider_health
    SET total_calls = total_calls + 1,
        consecutive_successes = consecutive_successes + 1,
        consecutive_failures = 0,
        last_success_at = now(),
        avg_latency_ms = (avg_latency_ms * 0.9) + (_latency_ms * 0.1),
        health_score = LEAST(100, health_score + 2),
        state = CASE WHEN state = 'half_open' AND consecutive_successes >= 2 THEN 'closed' ELSE state END,
        cooldown_until = CASE WHEN state = 'half_open' AND consecutive_successes >= 2 THEN NULL ELSE cooldown_until END,
        updated_at = now()
    WHERE provider = _provider;
  ELSE
    UPDATE public.provider_health
    SET total_calls = total_calls + 1,
        total_failures = total_failures + 1,
        consecutive_failures = consecutive_failures + 1,
        consecutive_successes = 0,
        last_failure_at = now(),
        health_score = GREATEST(0, health_score - 10),
        state = CASE WHEN consecutive_failures + 1 >= 5 THEN 'open' ELSE state END,
        cooldown_until = CASE WHEN consecutive_failures + 1 >= 5 THEN now() + interval '60 seconds' ELSE cooldown_until END,
        updated_at = now()
    WHERE provider = _provider
    RETURNING state, consecutive_failures INTO v_state, v_fails;

    IF v_state = 'open' THEN
      INSERT INTO public.system_alerts (alert_type, severity, title, message, metadata)
      VALUES ('provider_circuit_open','error',
              format('Circuit breaker aberto: %s', _provider),
              format('Provider %s atingiu %s falhas consecutivas. Cooldown 60s.', _provider, v_fails),
              jsonb_build_object('provider',_provider,'failures',v_fails));
    END IF;
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.record_provider_call(text,boolean,integer) FROM anon, authenticated;

-- Half-open reset cron
CREATE OR REPLACE FUNCTION public.reset_provider_circuits()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.provider_health
  SET state = 'half_open', consecutive_failures = 0, updated_at = now()
  WHERE state = 'open' AND cooldown_until IS NOT NULL AND cooldown_until < now();
$$;
REVOKE EXECUTE ON FUNCTION public.reset_provider_circuits() FROM anon, authenticated;

-- Operations summary view
CREATE OR REPLACE VIEW public.operations_overview
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.analysis_jobs WHERE status='queued') AS queued,
  (SELECT count(*) FROM public.analysis_jobs WHERE status='leased') AS leased,
  (SELECT count(*) FROM public.analysis_jobs WHERE status='running') AS running,
  (SELECT count(*) FROM public.analysis_jobs WHERE status='failed') AS failed,
  (SELECT count(*) FROM public.analysis_jobs WHERE status='dead') AS dead,
  (SELECT count(*) FROM public.analysis_jobs WHERE status='succeeded' AND completed_at > now()-interval '1 hour') AS succeeded_last_hour,
  (SELECT count(*) FROM public.worker_heartbeats WHERE last_heartbeat_at > now()-interval '2 minutes') AS active_workers,
  (SELECT count(*) FROM public.system_alerts WHERE resolved_at IS NULL) AS open_alerts;

GRANT SELECT ON public.operations_overview TO authenticated;

-- Cron: recover stuck jobs every minute, reset circuits every 30s
SELECT cron.schedule('recover-stuck-jobs','* * * * *', $$ SELECT public.recover_stuck_jobs(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='recover-stuck-jobs');

SELECT cron.schedule('reset-provider-circuits','* * * * *', $$ SELECT public.reset_provider_circuits(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='reset-provider-circuits');

-- Cleanup old metrics (keep 7 days) and history (keep 30 days)
CREATE OR REPLACE FUNCTION public.cleanup_pipeline_data()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.pipeline_metrics WHERE recorded_at < now() - interval '7 days';
  DELETE FROM public.job_execution_history WHERE started_at < now() - interval '30 days';
  DELETE FROM public.analysis_jobs WHERE status IN ('succeeded') AND completed_at < now() - interval '7 days';
  DELETE FROM public.system_alerts WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '30 days';
$$;
REVOKE EXECUTE ON FUNCTION public.cleanup_pipeline_data() FROM anon, authenticated;

SELECT cron.schedule('cleanup-pipeline-data','0 4 * * *', $$ SELECT public.cleanup_pipeline_data(); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='cleanup-pipeline-data');
