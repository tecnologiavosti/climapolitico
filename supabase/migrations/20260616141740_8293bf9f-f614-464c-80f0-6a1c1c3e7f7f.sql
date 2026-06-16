
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
  WITH base AS (
    SELECT
      si.sentiment_label,
      COALESCE(
        NULLIF(upper(si.state), ''),
        -- 1) extrai sigla UF (cidade)
        (regexp_match(upper(coalesce(si.city,'')),
          '(^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([^A-Z]|$)'))[2],
        -- 2) extrai sigla UF (autor / bio)
        (regexp_match(upper(coalesce(si.comment_author,'')),
          '(^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([^A-Z]|$)'))[2],
        -- 3) extrai sigla UF (texto)
        (regexp_match(upper(coalesce(si.comment_text,'')),
          '(^|[^A-Z])(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)([^A-Z]|$)'))[2],
        -- 4) fallback: deriva UF a partir da região quando há um único estado dominante (nenhum) → mantém NULL
        NULL
      ) AS uf
    FROM public.social_interactions si
    WHERE si.user_id = p_user_id
      AND si.candidate_id = p_candidate_id
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
      AND (p_networks IS NULL OR si.social_network = ANY(p_networks))
  )
  SELECT
    uf AS state,
    COUNT(*)::bigint AS mentions,
    COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('positive','positivo'))::bigint AS positive,
    COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('negative','negativo'))::bigint AS negative,
    COUNT(*) FILTER (WHERE sentiment_label IS NULL OR lower(sentiment_label) NOT IN ('positive','positivo','negative','negativo'))::bigint AS neutral,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('positive','positivo'))
      / NULLIF(COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('positive','positivo','negative','negativo')), 0),
      2
    ) AS positive_percentage,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('negative','negativo'))
      / NULLIF(COUNT(*) FILTER (WHERE lower(sentiment_label) IN ('positive','positivo','negative','negativo')), 0),
      2
    ) AS negative_percentage
  FROM base
  WHERE uf IS NOT NULL
  GROUP BY uf;
$$;
