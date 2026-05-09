
-- SLO targets
CREATE TABLE IF NOT EXISTS public.slo_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  metric_name text NOT NULL,
  comparator text NOT NULL DEFAULT 'lte', -- 'lte' | 'gte'
  target_value numeric NOT NULL,
  window_minutes integer NOT NULL DEFAULT 60,
  severity text NOT NULL DEFAULT 'warning',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.slo_targets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage slo_targets" ON public.slo_targets;
CREATE POLICY "Admins manage slo_targets" ON public.slo_targets
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER trg_slo_targets_updated
  BEFORE UPDATE ON public.slo_targets
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed default SLOs (idempotent)
INSERT INTO public.slo_targets (name, description, metric_name, comparator, target_value, window_minutes, severity)
VALUES
  ('Latência P95 análise (ms)', 'P95 de duração das análises deve ficar abaixo de 5s', 'analysis_duration_ms', 'lte', 5000, 60, 'warning'),
  ('Throughput análise/min', 'Pelo menos 10 análises por minuto na última hora', 'analysis_throughput', 'gte', 10, 60, 'warning'),
  ('Taxa de erro workers (%)', 'Taxa de falha de jobs deve ficar abaixo de 5%', 'job_error_rate', 'lte', 5, 60, 'critical')
ON CONFLICT (name) DO NOTHING;

-- SLO status function
CREATE OR REPLACE FUNCTION public.compute_slo_status()
RETURNS TABLE(
  slo_id uuid,
  name text,
  metric_name text,
  comparator text,
  target_value numeric,
  current_value numeric,
  is_compliant boolean,
  severity text,
  window_minutes integer,
  samples bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT t.id, t.name, t.metric_name, t.comparator, t.target_value, t.severity, t.window_minutes,
           COUNT(m.*) AS samples,
           CASE
             WHEN t.metric_name = 'analysis_throughput' THEN
               COALESCE(SUM(m.metric_value),0) / GREATEST(t.window_minutes,1)::numeric
             WHEN t.comparator = 'lte' THEN
               COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY m.metric_value), 0)
             ELSE
               COALESCE(AVG(m.metric_value),0)
           END AS current_value
    FROM public.slo_targets t
    LEFT JOIN public.pipeline_metrics m
      ON m.metric_name = t.metric_name
     AND m.recorded_at > now() - make_interval(mins => t.window_minutes)
    WHERE t.is_active = true
    GROUP BY t.id
  )
  SELECT a.id, a.name, a.metric_name, a.comparator, a.target_value, a.current_value,
         CASE
           WHEN a.samples = 0 THEN true
           WHEN a.comparator = 'lte' THEN a.current_value <= a.target_value
           ELSE a.current_value >= a.target_value
         END AS is_compliant,
         a.severity, a.window_minutes, a.samples
  FROM agg a
  ORDER BY is_compliant ASC, a.severity DESC, a.name ASC;
END;
$$;

-- Requeue dead jobs (admin)
CREATE OR REPLACE FUNCTION public.requeue_dead_jobs(_job_type text DEFAULT NULL, _limit integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH picked AS (
    SELECT id FROM public.analysis_jobs
    WHERE status = 'dead'
      AND (_job_type IS NULL OR job_type = _job_type)
    ORDER BY updated_at DESC
    LIMIT _limit
  ), upd AS (
    UPDATE public.analysis_jobs j
    SET status = 'queued',
        attempts = 0,
        worker_id = NULL,
        leased_at = NULL,
        lease_expires_at = NULL,
        scheduled_at = now(),
        last_error = COALESCE(j.last_error,'') || ' [requeued_by_admin]',
        updated_at = now()
    FROM picked WHERE j.id = picked.id
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;
  RETURN COALESCE(v_count,0);
END;
$$;

-- DLQ summary
CREATE OR REPLACE FUNCTION public.dlq_summary()
RETURNS TABLE(job_type text, dead_count bigint, oldest timestamptz, newest timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT j.job_type, count(*)::bigint, min(j.updated_at), max(j.updated_at)
  FROM public.analysis_jobs j
  WHERE j.status = 'dead'
  GROUP BY j.job_type
  ORDER BY count(*) DESC;
END;
$$;
