
CREATE OR REPLACE FUNCTION public.delete_candidate_cascade(_candidate_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _owner uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT user_id INTO _owner FROM public.candidates WHERE id = _candidate_id;
  IF _owner IS NULL THEN
    RETURN;
  END IF;
  IF _owner <> _uid AND NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  -- Delete all derived data for this candidate (scoped by candidate_id; FK owner already verified)
  DELETE FROM public.ai_insights WHERE candidate_id = _candidate_id;
  DELETE FROM public.analysis_jobs WHERE candidate_id = _candidate_id;
  DELETE FROM public.apify_runs WHERE candidate_id = _candidate_id;
  DELETE FROM public.candidate_analyses WHERE candidate_id = _candidate_id;
  DELETE FROM public.candidate_metrics_cache WHERE candidate_id = _candidate_id;
  DELETE FROM public.candidate_rankings WHERE candidate_id = _candidate_id;
  DELETE FROM public.candidate_social_links WHERE candidate_id = _candidate_id;
  DELETE FROM public.collection_configs WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_candidate_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_hashtag_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_heatmap_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_network_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_sentiment_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.daily_topic_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.data_consistency_audit_logs WHERE candidate_id = _candidate_id;
  DELETE FROM public.failed_analyses WHERE candidate_id = _candidate_id;
  DELETE FROM public.historical_mentions WHERE candidate_id = _candidate_id;
  DELETE FROM public.historical_metrics WHERE candidate_id = _candidate_id;
  DELETE FROM public.narrative_alerts WHERE candidate_id = _candidate_id;
  DELETE FROM public.network_view_cache WHERE candidate_id = _candidate_id;
  DELETE FROM public.network_view_query_logs WHERE candidate_id = _candidate_id;
  DELETE FROM public.notifications WHERE candidate_id = _candidate_id;
  DELETE FROM public.political_events WHERE candidate_id = _candidate_id;
  DELETE FROM public.radar_cache WHERE candidate_id = _candidate_id;
  DELETE FROM public.radar_jobs WHERE candidate_id = _candidate_id;
  DELETE FROM public.radar_pipeline_health WHERE candidate_id = _candidate_id;
  DELETE FROM public.regional_analytics_cache WHERE candidate_id = _candidate_id;
  DELETE FROM public.scheduled_reports WHERE candidate_id = _candidate_id;
  DELETE FROM public.social_interactions WHERE candidate_id = _candidate_id;
  DELETE FROM public.social_metrics_daily WHERE candidate_id = _candidate_id;
  DELETE FROM public.social_posts WHERE candidate_id = _candidate_id;
  DELETE FROM public.speech_analyses WHERE candidate_id = _candidate_id;
  DELETE FROM public.undecided_analyses WHERE candidate_id = _candidate_id;

  DELETE FROM public.candidates WHERE id = _candidate_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_candidate_cascade(uuid) TO authenticated;
