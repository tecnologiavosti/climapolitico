CREATE OR REPLACE FUNCTION public.nv_fast_sentiment(_label text, _score numeric DEFAULT NULL::numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(_label,'')) IN ('positivo','positive','pos','favoravel','favorável') THEN 'positive'
    WHEN lower(coalesce(_label,'')) IN ('negativo','negative','neg','critico','crítico','desfavoravel','desfavorável') THEN 'negative'
    WHEN lower(coalesce(_label,'')) IN ('neutro','neutral') AND _score IS NOT NULL AND _score >= 0.62 THEN 'positive'
    WHEN lower(coalesce(_label,'')) IN ('neutro','neutral') AND _score IS NOT NULL AND _score <= 0.38 THEN 'negative'
    WHEN lower(coalesce(_label,'')) IN ('neutro','neutral') THEN 'neutral'
    WHEN _score IS NOT NULL AND _score >= 0.62 THEN 'positive'
    WHEN _score IS NOT NULL AND _score <= 0.38 THEN 'negative'
    ELSE 'neutral'
  END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_social_metrics_daily(p_since date DEFAULT (current_date - 90), p_until date DEFAULT (current_date + 1))
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
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
      COALESCE(si.original_posted_at, si.created_at, si.collected_at)::date AS metric_date,
      si.user_id,
      si.candidate_id,
      public.nv_network_key(si.social_network) AS network,
      public.nv_fast_sentiment(si.sentiment_label, si.sentiment_score) AS sent,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS comments,
      COALESCE(si.shares_count,0)::bigint AS shares,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), si.id::text) AS author_key
    FROM public.social_interactions si
    WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= p_since::timestamptz
      AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < p_until::timestamptz
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
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
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_social_metrics_daily(date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_social_metrics_daily(date,date) TO authenticated, service_role;

DELETE FROM public.network_view_cache WHERE section IN ('core','content','top_posts');