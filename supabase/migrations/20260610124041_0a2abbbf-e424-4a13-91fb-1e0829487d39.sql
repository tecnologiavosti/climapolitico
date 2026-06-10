
-- =========================================================
-- A4 + M2: Hashtag normalization audit & Subject deduplication
-- =========================================================

-- ---------------------------------------------------------
-- M2: Deduplicate dominant topics by unique post identifier
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_reactions_dominant_topics(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL::uuid,
  _period_start timestamptz DEFAULT NULL::timestamptz,
  _period_end timestamptz DEFAULT NULL::timestamptz,
  _sample_limit integer DEFAULT 20000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH sample AS (
    SELECT
      lower(coalesce(si.comment_text,'')) AS txt,
      COALESCE(si.post_url, si.external_id, si.post_id, si.id::text) AS post_key
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.comment_text IS NOT NULL
      AND length(si.comment_text) > 0
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY coalesce(si.collected_at, si.created_at) DESC NULLS LAST
    LIMIT greatest(1000, least(coalesce(_sample_limit,20000), 50000))
  ), themed AS (
    SELECT
      theme,
      count(*)::bigint                          AS raw_mentions,
      count(DISTINCT post_key)::bigint          AS mentions
    FROM (
      SELECT post_key, CASE
        WHEN txt ~ '(econom|inflaç|emprego|salári|renda|imposto|tribut|preço|juros?|pib|custo de vida)' THEN 'economia'
        WHEN txt ~ '(segurança|crime|violência|polícia|tráfic|assalt|homicíd|facç|milíci)' THEN 'segurança'
        WHEN txt ~ '(saúde|hospital|sus|médic|vacin|remédi|doenç)' THEN 'saúde'
        WHEN txt ~ '(educaç|escola|professor|aluno|ensino|universidad|enem|creche)' THEN 'educação'
        WHEN txt ~ '(corrupç|propina|desvio|fraud|rachadinha|lava jato)' THEN 'corrupção'
        WHEN txt ~ '(eleiç|voto|votar|urna|campanha|candidat|presidente|governador|prefeito|senador|deputado)' THEN 'eleições'
        WHEN txt ~ '(imposto|tributo|taxa|tribut|arrecadaç|receita federal)' THEN 'impostos'
        WHEN txt ~ '(obra|estrada|transport|ônibus|metrô|sanea|moradia|habit)' THEN 'infraestrutura'
        WHEN txt ~ '(bolsa famíli|auxíli|benefíci|pobreza|fome|cadúnico)' THEN 'programas sociais'
        WHEN txt ~ '(meio ambient|amazôni|clima|desmatament|queimad|enchent)' THEN 'meio ambiente'
        ELSE NULL END AS theme
      FROM sample
    ) t
    WHERE theme IS NOT NULL
    GROUP BY theme
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'topic',        theme,
    'mentions',     mentions,
    'raw_mentions', raw_mentions,
    'inflation_pct', CASE WHEN mentions > 0
                          THEN round(((raw_mentions - mentions)::numeric / mentions) * 100, 2)
                          ELSE 0 END
  ) ORDER BY mentions DESC),'[]'::jsonb)
  INTO v_result FROM themed;

  RETURN coalesce(v_result,'[]'::jsonb);
END
$function$;

-- ---------------------------------------------------------
-- M2 audit: per-theme inflation report
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nv_subject_dedup_audit(p_days integer DEFAULT 30)
RETURNS TABLE (
  theme           text,
  raw_count       bigint,
  dedup_count     bigint,
  inflation_pct   numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      COALESCE(si.post_url, si.external_id, si.post_id, si.id::text) AS post_key,
      CASE
        WHEN lower(coalesce(si.comment_text,'')) ~ '(econom|inflaç|emprego|salári|renda|imposto|tribut|preço|juros?|pib|custo de vida)' THEN 'economia'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(segurança|crime|violência|polícia|tráfic|assalt|homicíd|facç|milíci)' THEN 'segurança'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(saúde|hospital|sus|médic|vacin|remédi|doenç)' THEN 'saúde'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(educaç|escola|professor|aluno|ensino|universidad|enem|creche)' THEN 'educação'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(corrupç|propina|desvio|fraud|rachadinha|lava jato)' THEN 'corrupção'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(eleiç|voto|votar|urna|campanha|candidat|presidente|governador|prefeito|senador|deputado)' THEN 'eleições'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(obra|estrada|transport|ônibus|metrô|sanea|moradia|habit)' THEN 'infraestrutura'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(bolsa famíli|auxíli|benefíci|pobreza|fome|cadúnico)' THEN 'programas sociais'
        WHEN lower(coalesce(si.comment_text,'')) ~ '(meio ambient|amazôni|clima|desmatament|queimad|enchent)' THEN 'meio ambiente'
        ELSE NULL
      END AS theme
    FROM public.social_interactions si
    WHERE coalesce(si.collected_at, si.created_at) >= now() - (greatest(1, p_days) || ' days')::interval
      AND si.comment_text IS NOT NULL
      AND public.has_role(auth.uid(), 'admin'::app_role)
  )
  SELECT
    theme,
    count(*)::bigint                  AS raw_count,
    count(DISTINCT post_key)::bigint  AS dedup_count,
    CASE WHEN count(DISTINCT post_key) > 0
         THEN round(((count(*) - count(DISTINCT post_key))::numeric
                     / count(DISTINCT post_key)) * 100, 2)
         ELSE 0 END                   AS inflation_pct
  FROM base
  WHERE theme IS NOT NULL
  GROUP BY theme
  ORDER BY raw_count DESC;
$function$;

-- ---------------------------------------------------------
-- A4 audit: hashtag normalization consolidation report
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nv_hashtag_normalization_audit(p_days integer DEFAULT 30)
RETURNS TABLE (
  normalized_tag   text,
  display_tag      text,
  variant_count    bigint,
  variants         text[],
  consolidated_mentions bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH src AS (
    SELECT
      tag                                AS raw_tag,
      public.nv_normalize_hashtag(tag)   AS norm,
      public.nv_hashtag_display(tag)     AS disp,
      mentions
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= current_date - greatest(1, p_days)
      AND public.has_role(auth.uid(), 'admin'::app_role)
      AND public.nv_is_valid_hashtag(replace(tag, '#', ''))
  )
  SELECT
    norm                                       AS normalized_tag,
    max(disp)                                  AS display_tag,
    count(DISTINCT raw_tag)::bigint            AS variant_count,
    array_agg(DISTINCT raw_tag ORDER BY raw_tag) AS variants,
    sum(mentions)::bigint                      AS consolidated_mentions
  FROM src
  WHERE norm IS NOT NULL
  GROUP BY norm
  HAVING count(DISTINCT raw_tag) >= 1
  ORDER BY consolidated_mentions DESC
  LIMIT 50;
$function$;

GRANT EXECUTE ON FUNCTION public.nv_subject_dedup_audit(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nv_hashtag_normalization_audit(integer) TO authenticated;
