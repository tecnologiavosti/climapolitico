REVOKE ALL ON public.pipeline_metrics_hourly FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_pipeline_metrics_hourly(_metric text DEFAULT NULL, _hours integer DEFAULT 24)
RETURNS TABLE (bucket timestamptz, metric_name text, samples bigint, avg_value numeric, p50 numeric, p95 numeric, p99 numeric, max_value numeric, sum_value numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT m.bucket, m.metric_name, m.samples, m.avg_value, m.p50, m.p95, m.p99, m.max_value, m.sum_value
  FROM public.pipeline_metrics_hourly m
  WHERE (_metric IS NULL OR m.metric_name = _metric)
    AND m.bucket > now() - make_interval(hours => _hours)
  ORDER BY m.bucket DESC;
END; $$;
REVOKE EXECUTE ON FUNCTION public.get_pipeline_metrics_hourly(text,integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_metrics_hourly(text,integer) TO authenticated;