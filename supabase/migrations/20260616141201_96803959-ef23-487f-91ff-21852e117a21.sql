
CREATE OR REPLACE FUNCTION public.get_regional_state_aggregates(
  p_user_id uuid,
  p_candidate_id uuid,
  p_networks text[] DEFAULT NULL
)
RETURNS TABLE (
  state text,
  mentions bigint,
  positive bigint,
  negative bigint,
  neutral bigint,
  positive_percentage numeric,
  negative_percentage numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    si.state,
    COUNT(*)::bigint AS mentions,
    COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('positive','positivo'))::bigint AS positive,
    COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('negative','negativo'))::bigint AS negative,
    COUNT(*) FILTER (WHERE si.sentiment_label IS NULL OR lower(si.sentiment_label) NOT IN ('positive','positivo','negative','negativo'))::bigint AS neutral,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('positive','positivo'))
      / NULLIF(COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('positive','positivo','negative','negativo')), 0),
      2
    ) AS positive_percentage,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('negative','negativo'))
      / NULLIF(COUNT(*) FILTER (WHERE lower(si.sentiment_label) IN ('positive','positivo','negative','negativo')), 0),
      2
    ) AS negative_percentage
  FROM public.social_interactions si
  WHERE si.user_id = p_user_id
    AND si.candidate_id = p_candidate_id
    AND si.state IS NOT NULL
    AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
    AND (p_networks IS NULL OR si.social_network = ANY(p_networks))
  GROUP BY si.state;
$$;

GRANT EXECUTE ON FUNCTION public.get_regional_state_aggregates(uuid, uuid, text[]) TO authenticated, service_role;
