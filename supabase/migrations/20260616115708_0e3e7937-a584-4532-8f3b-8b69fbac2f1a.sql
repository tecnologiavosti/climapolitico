CREATE OR REPLACE FUNCTION public.refresh_social_metrics_daily(p_since date DEFAULT (CURRENT_DATE - 90), p_until date DEFAULT (CURRENT_DATE + 1))
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '0'
AS $function$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RAISE EXCEPTION 'Intervalo inválido.';
  END IF;

  DELETE FROM public.social_metrics_daily
  WHERE date >= p_since AND date < p_until;

  WITH prepared AS MATERIALIZED (
    SELECT
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at)::date AS metric_date,
      si.user_id,
      si.candidate_id,
      public.nv_network_key(si.social_network) AS network,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
      GREATEST(COALESCE(si.likes_count,0),0)::bigint AS likes,
      GREATEST(COALESCE(si.replies_count,0),0)::bigint AS comments,
      GREATEST(COALESCE(si.shares_count,0),0)::bigint AS shares,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), si.id::text) AS author_key
    FROM public.social_interactions si
    WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= p_since::timestamptz
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < p_until::timestamptz
      AND si.invalidated_at IS NULL
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
  )
  INSERT INTO public.social_metrics_daily (
    date, user_id, candidate_id, network, mentions, positive, negative, neutral,
    likes, comments, shares, unique_authors, updated_at
  )
  SELECT
    metric_date,
    user_id,
    candidate_id,
    network,
    count(*)::bigint,
    count(*) FILTER (WHERE sent = 'positive')::bigint,
    count(*) FILTER (WHERE sent = 'negative')::bigint,
    count(*) FILTER (WHERE sent = 'neutral')::bigint,
    sum(likes)::bigint,
    sum(comments)::bigint,
    sum(shares)::bigint,
    count(DISTINCT author_key)::bigint,
    now()
  FROM prepared
  GROUP BY 1,2,3,4
  ON CONFLICT (date, user_id, candidate_id, network) DO UPDATE SET
    mentions = EXCLUDED.mentions,
    positive = EXCLUDED.positive,
    negative = EXCLUDED.negative,
    neutral = EXCLUDED.neutral,
    likes = EXCLUDED.likes,
    comments = EXCLUDED.comments,
    shares = EXCLUDED.shares,
    unique_authors = EXCLUDED.unique_authors,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'since', p_since, 'until', p_until);
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_social_metrics_daily(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_social_metrics_daily(date,date) TO authenticated, service_role;

DELETE FROM public.network_view_cache;