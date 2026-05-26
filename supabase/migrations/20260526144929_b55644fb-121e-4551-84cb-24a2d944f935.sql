
-- Split heavy get_reactions_per_post_summary into smaller parallel RPCs.
-- Each function is focused and fast (<2s on 100k rows), so frontend can Promise.allSettled
-- and survive individual failures / timeouts.

-- Composite index to accelerate filter_at range scans per user/candidate.
CREATE INDEX IF NOT EXISTS idx_social_interactions_user_candidate_filterat
  ON public.social_interactions (user_id, candidate_id, (coalesce(collected_at, created_at)) DESC);

-- ============================================================
-- 1) TOTALS — counts, sentiment counts, posts/comments breakdown,
--    engagement aggregates and network breakdown
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_totals(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
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
      lower(coalesce(si.interaction_type,'comment')) AS it,
      lower(coalesce(si.sentiment_label,'')) AS sl,
      coalesce(si.likes_count,0)::bigint AS l,
      coalesce(si.replies_count,0)::bigint AS r,
      coalesce(si.shares_count,0)::bigint AS s,
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        WHEN lower(coalesce(si.social_network,'')) = 'telegram' THEN 'Telegram'
        WHEN lower(coalesce(si.social_network,'')) = 'linkedin' THEN 'LinkedIn'
        WHEN lower(coalesce(si.social_network,'')) = 'instagram' THEN 'Instagram'
        WHEN lower(coalesce(si.social_network,'')) = 'reddit' THEN 'Reddit'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS network
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), agg AS (
    SELECT
      count(*)::bigint AS total_records,
      count(*) FILTER (WHERE it IN ('post','mention','tweet','news','video','article','section','related','revision'))::bigint AS posts_count,
      count(*) FILTER (WHERE it = 'comment')::bigint AS direct_comments_count,
      count(*) FILTER (WHERE it IN ('reply','response'))::bigint AS replies_rows_count,
      count(*) FILTER (WHERE it = 'subcomment')::bigint AS subcomments_count,
      count(*) FILTER (WHERE sl IN ('positivo','positive','pos'))::bigint AS positive_count,
      count(*) FILTER (WHERE sl IN ('negativo','negative','neg'))::bigint AS negative_count,
      count(*) FILTER (WHERE sl IN ('neutro','neutral','neu'))::bigint AS neutral_count,
      coalesce(sum(l),0)::bigint AS total_likes,
      coalesce(sum(r),0)::bigint AS total_replies,
      coalesce(sum(s),0)::bigint AS total_shares,
      coalesce(sum(l + r + s),0)::bigint AS metric_engagement
    FROM base
  ), nb AS (
    SELECT network, count(*)::bigint AS total FROM base GROUP BY network
  )
  SELECT jsonb_build_object(
    'totalRecords', a.total_records,
    'postsCount', a.posts_count,
    'directCommentsCount', a.direct_comments_count,
    'repliesRowsCount', a.replies_rows_count,
    'subcommentsCount', a.subcomments_count,
    'commentsCount', a.direct_comments_count + a.replies_rows_count + a.subcomments_count,
    'positiveCount', a.positive_count,
    'negativeCount', a.negative_count,
    'neutralCount', a.neutral_count,
    'classifiedCount', a.positive_count + a.negative_count + a.neutral_count,
    'pendingCount', a.total_records - (a.positive_count + a.negative_count + a.neutral_count),
    'totalLikes', a.total_likes,
    'totalReplies', a.total_replies,
    'totalShares', a.total_shares,
    'totalInteractions', a.metric_engagement,
    'networkBreakdown', coalesce((SELECT jsonb_agg(jsonb_build_object('network',network,'total',total) ORDER BY total DESC, network) FROM nb),'[]'::jsonb)
  ) INTO v_result FROM agg a;

  RETURN coalesce(v_result, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_totals(uuid,uuid,timestamptz,timestamptz) TO authenticated, service_role;

-- ============================================================
-- 2) ENGAGEMENT BY NETWORK
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_engagement_by_network(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
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
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        WHEN lower(coalesce(si.social_network,'')) = 'telegram' THEN 'Telegram'
        WHEN lower(coalesce(si.social_network,'')) = 'linkedin' THEN 'LinkedIn'
        WHEN lower(coalesce(si.social_network,'')) = 'instagram' THEN 'Instagram'
        WHEN lower(coalesce(si.social_network,'')) = 'reddit' THEN 'Reddit'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS rede,
      coalesce(si.likes_count,0)::bigint AS l,
      coalesce(si.replies_count,0)::bigint AS r,
      coalesce(si.shares_count,0)::bigint AS s
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  )
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'engajamento')::bigint DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'rede', rede,
      'registros', count(*)::bigint,
      'curtidas', sum(l)::bigint,
      'comentarios_respostas', sum(r)::bigint,
      'compartilhamentos', sum(s)::bigint,
      'engajamento', sum(l + r + s)::bigint
    ) AS row
    FROM base GROUP BY rede
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_engagement_by_network(uuid,uuid,timestamptz,timestamptz) TO authenticated, service_role;

-- ============================================================
-- 3) SENTIMENT BY NETWORK
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_sentiment_by_network(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
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
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        WHEN lower(coalesce(si.social_network,'')) = 'telegram' THEN 'Telegram'
        WHEN lower(coalesce(si.social_network,'')) = 'linkedin' THEN 'LinkedIn'
        WHEN lower(coalesce(si.social_network,'')) = 'instagram' THEN 'Instagram'
        WHEN lower(coalesce(si.social_network,'')) = 'reddit' THEN 'Reddit'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS rede,
      CASE
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('positivo','positive','pos') THEN 'p'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('negativo','negative','neg') THEN 'n'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'u'
        ELSE 'x'
      END AS sk
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  )
  SELECT coalesce(jsonb_agg(row ORDER BY (row->>'total')::bigint DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'rede', rede,
      'total', count(*)::bigint,
      'positivo', count(*) FILTER (WHERE sk='p')::bigint,
      'neutro', count(*) FILTER (WHERE sk='u')::bigint,
      'negativo', count(*) FILTER (WHERE sk='n')::bigint,
      'sem_classificacao', count(*) FILTER (WHERE sk='x')::bigint
    ) AS row
    FROM base GROUP BY rede
  ) t;

  RETURN coalesce(v_result, '[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_sentiment_by_network(uuid,uuid,timestamptz,timestamptz) TO authenticated, service_role;

-- ============================================================
-- 4) ACTIVITY BY HOUR/WEEKDAY
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_activity_hour_week(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
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
      extract(dow FROM coalesce(si.original_posted_at, si.collected_at, si.created_at))::int AS dia,
      extract(hour FROM coalesce(si.original_posted_at, si.collected_at, si.created_at))::int AS hora,
      (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint AS eng
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND coalesce(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'dia_semana', dia, 'hora', hora,
    'registros', c, 'engajamento', e
  ) ORDER BY dia, hora),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT dia, hora, count(*)::bigint AS c, sum(eng)::bigint AS e
    FROM base GROUP BY dia, hora
  ) t;

  RETURN coalesce(v_result,'[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_activity_hour_week(uuid,uuid,timestamptz,timestamptz) TO authenticated, service_role;

-- ============================================================
-- 5) TOP POSTS (limit 5)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_top_posts(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL,
  _limit int DEFAULT 5
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

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'social_network', social_network,
    'likes_count', likes_count,
    'replies_count', replies_count,
    'shares_count', shares_count,
    'sentiment_label', sentiment_label,
    'collected_at', collected_at,
    'engagement', engagement
  ) ORDER BY engagement DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      si.id,
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS social_network,
      coalesce(si.likes_count,0) AS likes_count,
      coalesce(si.replies_count,0) AS replies_count,
      coalesce(si.shares_count,0) AS shares_count,
      CASE
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro'
        ELSE NULL
      END AS sentiment_label,
      coalesce(si.collected_at, si.created_at) AS collected_at,
      (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint AS engagement
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY engagement DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(_limit,5), 20))
  ) t;

  RETURN coalesce(v_result,'[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;

-- ============================================================
-- 6) DOMINANT TOPICS (heaviest — text matching, sampled to keep <5s)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_reactions_dominant_topics(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL,
  _sample_limit int DEFAULT 20000
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

  WITH sample AS (
    SELECT lower(coalesce(si.comment_text,'')) AS txt
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
    SELECT theme, count(*)::bigint AS mentions FROM (
      SELECT CASE
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
    ) t WHERE theme IS NOT NULL GROUP BY theme
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('topic',theme,'mentions',mentions) ORDER BY mentions DESC),'[]'::jsonb)
  INTO v_result FROM themed;

  RETURN coalesce(v_result,'[]'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_reactions_dominant_topics(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;
