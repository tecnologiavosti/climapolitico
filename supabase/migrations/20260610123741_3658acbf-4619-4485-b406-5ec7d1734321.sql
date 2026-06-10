CREATE OR REPLACE FUNCTION public.overview_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_since timestamptz := (current_date - (v_days - 1))::timestamptz;
  v_until timestamptz := now() + interval '1 minute';
  v_visible text[] := public.nv_visible_networks();
  v_kpis jsonb;
  v_by_network jsonb;
  v_by_candidate jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  WITH base AS (
    SELECT
      candidate_id,
      public.nv_network_key(social_network) AS network,
      comment_author,
      sentiment_label,
      (coalesce(likes_count,0)+coalesce(replies_count,0)+coalesce(shares_count,0))::bigint AS eng
    FROM public.social_interactions si
    WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_since
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND public.nv_network_key(si.social_network) = ANY (v_visible)
  )
  SELECT
    jsonb_build_object(
      'total', count(*)::bigint,
      'authors', count(DISTINCT comment_author)::bigint,
      'engagement', coalesce(sum(eng),0)::bigint,
      'pos', count(*) FILTER (WHERE sentiment_label = 'Positivo')::bigint,
      'neg', count(*) FILTER (WHERE sentiment_label = 'Negativo')::bigint,
      'neu', count(*) FILTER (WHERE sentiment_label NOT IN ('Positivo','Negativo') OR sentiment_label IS NULL)::bigint
    ),
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'network', network, 'mentions', mentions, 'engagement', engagement,
        'authors', authors, 'pos', pos, 'neg', neg, 'neu', neu
      ) ORDER BY mentions DESC), '[]'::jsonb)
      FROM (
        SELECT network,
          count(*)::bigint AS mentions,
          count(DISTINCT comment_author)::bigint AS authors,
          coalesce(sum(eng),0)::bigint AS engagement,
          count(*) FILTER (WHERE sentiment_label='Positivo')::bigint AS pos,
          count(*) FILTER (WHERE sentiment_label='Negativo')::bigint AS neg,
          count(*) FILTER (WHERE sentiment_label NOT IN ('Positivo','Negativo') OR sentiment_label IS NULL)::bigint AS neu
        FROM base GROUP BY network
      ) bn
    ),
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'candidate_id', candidate_id, 'mentions', mentions, 'engagement', engagement,
        'authors', authors, 'pos', pos, 'neg', neg, 'neu', neu
      ) ORDER BY mentions DESC), '[]'::jsonb)
      FROM (
        SELECT candidate_id,
          count(*)::bigint AS mentions,
          count(DISTINCT comment_author)::bigint AS authors,
          coalesce(sum(eng),0)::bigint AS engagement,
          count(*) FILTER (WHERE sentiment_label='Positivo')::bigint AS pos,
          count(*) FILTER (WHERE sentiment_label='Negativo')::bigint AS neg,
          count(*) FILTER (WHERE sentiment_label NOT IN ('Positivo','Negativo') OR sentiment_label IS NULL)::bigint AS neu
        FROM base
        WHERE candidate_id IS NOT NULL
        GROUP BY candidate_id
        ORDER BY 2 DESC
        LIMIT 200
      ) bc
    )
  INTO v_kpis, v_by_network, v_by_candidate
  FROM base;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'days', v_days,
      'since', v_since,
      'kpis', coalesce(v_kpis, jsonb_build_object('total',0,'authors',0,'engagement',0,'pos',0,'neg',0,'neu',0)),
      'by_network', coalesce(v_by_network, '[]'::jsonb),
      'by_candidate', coalesce(v_by_candidate, '[]'::jsonb)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.overview_summary(integer) TO authenticated;