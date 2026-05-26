
CREATE OR REPLACE FUNCTION public.get_cities_ranking_summary(
  _user_id uuid,
  _candidate_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH base AS (
    SELECT
      si.id, si.sentiment_label,
      coalesce(si.collected_at, si.created_at) AS at,
      lower(left(coalesce(si.comment_text,''), 300) || ' ' || coalesce(si.comment_author,'')) AS hay,
      si.city AS r_city, si.state AS r_state
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND si.candidate_id = _candidate_id
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY coalesce(si.collected_at, si.created_at) DESC NULLS LAST
    LIMIT 50000
  ),
  dict AS (SELECT * FROM public._regional_city_dict()),
  resolved AS (
    SELECT
      b.id, b.sentiment_label, b.at,
      CASE
        WHEN b.r_city IS NOT NULL AND length(trim(b.r_city)) > 0 THEN b.r_city
        ELSE (SELECT d.city FROM dict d
              WHERE position(d.norm IN b.hay) > 0
              ORDER BY length(d.norm) DESC LIMIT 1)
      END AS city,
      CASE
        WHEN b.r_state IS NOT NULL AND length(trim(b.r_state)) > 0 THEN upper(b.r_state)
        ELSE (SELECT d.uf FROM dict d
              WHERE position(d.norm IN b.hay) > 0
              ORDER BY length(d.norm) DESC LIMIT 1)
      END AS uf
    FROM base b
  ),
  agg AS (
    SELECT
      city, uf,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos'))::bigint AS pos,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg'))::bigint AS neg,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu'))::bigint AS neu,
      count(*) FILTER (WHERE at >= now() - interval '7 days')::bigint AS recent,
      count(*) FILTER (WHERE at >= now() - interval '14 days' AND at < now() - interval '7 days')::bigint AS previous
    FROM resolved
    WHERE city IS NOT NULL
    GROUP BY city, uf
  )
  SELECT jsonb_build_object(
    'cities', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'city', city, 'uf', uf, 'total', total,
        'pos', pos, 'neg', neg, 'neu', neu,
        'recent', recent, 'previous', previous
      ) ORDER BY total DESC) FROM agg), '[]'::jsonb),
    'totalRecords', (SELECT count(*) FROM resolved),
    'withCity', (SELECT count(*) FROM resolved WHERE city IS NOT NULL),
    'withoutCity', (SELECT count(*) FROM resolved WHERE city IS NULL)
  ) INTO v_result;

  RETURN coalesce(v_result, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_cities_ranking_summary(uuid, uuid) TO authenticated, service_role;
