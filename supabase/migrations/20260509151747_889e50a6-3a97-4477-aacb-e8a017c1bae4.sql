
-- Worker API tokens (for external Docker/Railway workers)
CREATE TABLE IF NOT EXISTS public.worker_api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  token_prefix text NOT NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['worker:claim','worker:complete'],
  created_by uuid,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_tokens_active
  ON public.worker_api_tokens (token_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE public.worker_api_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage worker tokens" ON public.worker_api_tokens;
CREATE POLICY "Admins manage worker tokens" ON public.worker_api_tokens
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- Verify worker token (called by edge functions via service role)
CREATE OR REPLACE FUNCTION public.verify_worker_token(_token text, _required_scope text DEFAULT 'worker:claim')
RETURNS TABLE(token_id uuid, name text, scopes text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_hash text;
BEGIN
  v_hash := encode(digest(_token, 'sha256'), 'hex');
  RETURN QUERY
  UPDATE public.worker_api_tokens t
  SET last_used_at = now()
  WHERE t.token_hash = v_hash
    AND t.revoked_at IS NULL
    AND (t.expires_at IS NULL OR t.expires_at > now())
    AND _required_scope = ANY(t.scopes)
  RETURNING t.id, t.name, t.scopes;
END; $$;

REVOKE EXECUTE ON FUNCTION public.verify_worker_token(text, text) FROM anon, authenticated;

-- Retention policies (single entrypoint for cleanup cron)
CREATE OR REPLACE FUNCTION public.enforce_retention_policies()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_metrics integer;
  v_history integer;
  v_notif integer;
  v_exports integer;
  v_alerts integer;
  v_jobs integer;
  v_cache integer;
BEGIN
  WITH d AS (DELETE FROM public.pipeline_metrics WHERE recorded_at < now() - interval '7 days' RETURNING 1)
    SELECT count(*) INTO v_metrics FROM d;
  WITH d AS (DELETE FROM public.job_execution_history WHERE started_at < now() - interval '30 days' RETURNING 1)
    SELECT count(*) INTO v_history FROM d;
  WITH d AS (DELETE FROM public.notifications
             WHERE (is_read = true AND created_at < now() - interval '30 days')
                OR (is_read = false AND created_at < now() - interval '90 days')
             RETURNING 1)
    SELECT count(*) INTO v_notif FROM d;
  WITH d AS (DELETE FROM public.export_jobs
             WHERE created_at < now() - interval '60 days'
               AND status IN ('succeeded','failed')
             RETURNING 1)
    SELECT count(*) INTO v_exports FROM d;
  WITH d AS (DELETE FROM public.system_alerts
             WHERE resolved_at IS NOT NULL AND resolved_at < now() - interval '30 days'
             RETURNING 1)
    SELECT count(*) INTO v_alerts FROM d;
  WITH d AS (DELETE FROM public.analysis_jobs
             WHERE status = 'succeeded' AND completed_at < now() - interval '7 days'
             RETURNING 1)
    SELECT count(*) INTO v_jobs FROM d;
  WITH d AS (DELETE FROM public.analysis_cache WHERE expires_at < now() RETURNING 1)
    SELECT count(*) INTO v_cache FROM d;

  RETURN jsonb_build_object(
    'pipeline_metrics', v_metrics,
    'job_execution_history', v_history,
    'notifications', v_notif,
    'export_jobs', v_exports,
    'system_alerts', v_alerts,
    'analysis_jobs', v_jobs,
    'analysis_cache', v_cache,
    'ran_at', now()
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.enforce_retention_policies() FROM anon, authenticated;

-- Generate token (admin only) — returns plaintext ONCE
CREATE OR REPLACE FUNCTION public.create_worker_token(_name text, _scopes text[] DEFAULT ARRAY['worker:claim','worker:complete'], _expires_days integer DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token text;
  v_hash text;
  v_prefix text;
  v_id uuid;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  v_token := 'wkr_' || encode(gen_random_bytes(32), 'hex');
  v_hash := encode(digest(v_token, 'sha256'), 'hex');
  v_prefix := substr(v_token, 1, 12);

  INSERT INTO public.worker_api_tokens (name, token_hash, token_prefix, scopes, created_by, expires_at)
  VALUES (_name, v_hash, v_prefix, _scopes, auth.uid(),
          CASE WHEN _expires_days IS NOT NULL THEN now() + make_interval(days => _expires_days) ELSE NULL END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'name', _name, 'token', v_token, 'prefix', v_prefix);
END; $$;
