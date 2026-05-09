
DROP VIEW IF EXISTS public.observability_overview;
CREATE VIEW public.observability_overview
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM social_interactions WHERE sentiment_label IS NULL) AS unlabeled_count,
  (SELECT count(*) FROM social_interactions) AS total_interactions,
  (SELECT count(*) FROM social_interactions WHERE sentiment_label='neutral' AND COALESCE(sentiment_confidence,0) < 0.6) AS low_confidence_neutrals,
  (SELECT count(*) FROM failed_analyses WHERE resolved_at IS NULL) AS dlq_pending,
  (SELECT count(*) FROM notifications WHERE is_read=false) AS unread_notifications,
  (SELECT avg(duration_ms)::int FROM edge_function_logs WHERE executed_at > now() - interval '1 hour') AS avg_duration_ms_1h,
  (SELECT count(*) FROM edge_function_logs WHERE status='error' AND executed_at > now() - interval '1 hour') AS errors_1h,
  (SELECT count(*) FROM edge_function_logs WHERE executed_at > now() - interval '1 hour') AS calls_1h;

REVOKE ALL ON public.observability_overview FROM anon;
GRANT SELECT ON public.observability_overview TO authenticated;
