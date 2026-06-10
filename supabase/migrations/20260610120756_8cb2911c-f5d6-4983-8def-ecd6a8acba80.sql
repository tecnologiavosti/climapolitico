
CREATE OR REPLACE FUNCTION public.collector_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  result jsonb;
BEGIN
  WITH quota AS (
    SELECT
      collector_name,
      daily_calls,
      daily_errors,
      daily_items_collected,
      max_daily_calls,
      last_call_at,
      last_reset_at,
      paused_until,
      notes,
      CASE WHEN daily_calls > 0
           THEN round(100.0 * (daily_calls - daily_errors)::numeric / daily_calls, 1)
           ELSE NULL END AS success_rate,
      CASE WHEN max_daily_calls > 0
           THEN round(100.0 * daily_calls::numeric / max_daily_calls, 1)
           ELSE NULL END AS quota_used_pct,
      EXTRACT(EPOCH FROM (now() - last_call_at))::int AS seconds_since_last_call
    FROM public.collector_quota_state
  ),
  vol AS (
    SELECT
      lower(social_network) AS network,
      count(*) FILTER (WHERE collected_at >= now() - interval '1 hour')  AS v_1h,
      count(*) FILTER (WHERE collected_at >= now() - interval '24 hours') AS v_24h,
      count(*) FILTER (WHERE collected_at >= now() - interval '7 days')   AS v_7d,
      count(*) FILTER (WHERE collected_at >= now() - interval '30 days')  AS v_30d,
      count(*) FILTER (WHERE collected_at >= now() - interval '60 days' AND collected_at < now() - interval '30 days') AS v_30d_prev,
      max(collected_at) AS last_ingest_at
    FROM public.social_interactions
    WHERE collected_at >= now() - interval '60 days'
    GROUP BY lower(social_network)
  ),
  hourly AS (
    SELECT
      lower(social_network) AS network,
      date_trunc('hour', collected_at) AS hour,
      count(*) AS c
    FROM public.social_interactions
    WHERE collected_at >= now() - interval '24 hours'
    GROUP BY 1,2
  ),
  hourly_json AS (
    SELECT network, jsonb_agg(jsonb_build_object('hour', hour, 'count', c) ORDER BY hour) AS series
    FROM hourly
    GROUP BY network
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'collectors', (
      SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.collector_name), '[]'::jsonb) FROM quota q
    ),
    'volume_by_network', (
      SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.v_30d DESC), '[]'::jsonb) FROM vol v
    ),
    'hourly_by_network', (
      SELECT coalesce(jsonb_object_agg(network, series), '{}'::jsonb) FROM hourly_json
    ),
    'totals', (
      SELECT jsonb_build_object(
        'collected_24h', sum(v_24h),
        'collected_7d',  sum(v_7d),
        'collected_30d', sum(v_30d),
        'collected_30d_prev', sum(v_30d_prev),
        'recovery_pct', CASE WHEN sum(v_30d_prev) > 0
                             THEN round(100.0 * sum(v_30d)::numeric / sum(v_30d_prev), 1)
                             ELSE NULL END
      ) FROM vol
    )
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.collector_health_snapshot() TO authenticated, service_role;
