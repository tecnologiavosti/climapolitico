CREATE OR REPLACE FUNCTION public.get_reactions_per_post_summary(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      si.id,
      si.comment_text,
      coalesce(nullif(si.social_network, ''), 'outro') AS raw_network,
      CASE
        WHEN lower(coalesce(si.social_network, '')) IN ('youtube', 'yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network, '')) IN ('tiktok', 'tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network, '')) IN ('twitter', 'twitter/x', 'x', 'twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network, '')) IN ('facebook', 'fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network, '')) IN ('google news', 'google_news', 'googlenews', 'news') THEN 'Google News'
        WHEN lower(coalesce(si.social_network, '')) = 'telegram' THEN 'Telegram'
        WHEN lower(coalesce(si.social_network, '')) = 'linkedin' THEN 'LinkedIn'
        WHEN lower(coalesce(si.social_network, '')) = 'instagram' THEN 'Instagram'
        WHEN lower(coalesce(si.social_network, '')) = 'reddit' THEN 'Reddit'
        ELSE initcap(replace(coalesce(nullif(si.social_network, ''), 'outro'), '_', ' '))
      END AS network,
      lower(coalesce(nullif(si.interaction_type, ''), 'comment')) AS interaction_type,
      CASE
        WHEN lower(coalesce(si.sentiment_label, '')) IN ('positivo', 'positive', 'pos') THEN 'positive'
        WHEN lower(coalesce(si.sentiment_label, '')) IN ('negativo', 'negative', 'neg') THEN 'negative'
        WHEN lower(coalesce(si.sentiment_label, '')) IN ('neutro', 'neutral', 'neu') THEN 'neutral'
        ELSE 'pending'
      END AS sentiment_key,
      coalesce(si.likes_count, 0)::bigint AS likes_count,
      coalesce(si.replies_count, 0)::bigint AS replies_count,
      coalesce(si.shares_count, 0)::bigint AS shares_count,
      coalesce(si.collected_at, si.created_at) AS filter_at,
      coalesce(si.original_posted_at, si.collected_at, si.created_at) AS activity_at
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network, '')) NOT IN ('mastodon', 'lemmy', 'pinterest', 'gdelt')
  ), enriched AS MATERIALIZED (
    SELECT
      *,
      CASE WHEN interaction_type IN ('post', 'mention', 'tweet', 'news', 'video', 'article', 'section', 'related', 'revision') THEN 1 ELSE 0 END AS is_post,
      CASE WHEN interaction_type = 'comment' THEN 1 ELSE 0 END AS is_comment,
      CASE WHEN interaction_type IN ('reply', 'response') THEN 1 ELSE 0 END AS is_reply,
      CASE WHEN interaction_type = 'subcomment' THEN 1 ELSE 0 END AS is_subcomment
    FROM filtered
  ), scored AS MATERIALIZED (
    SELECT
      *,
      (is_comment + is_reply + is_subcomment + replies_count) AS comments_replies_engagement,
      (likes_count + shares_count + is_comment + is_reply + is_subcomment + replies_count) AS engagement
    FROM enriched
  ), agg AS (
    SELECT
      count(*)::bigint AS total_records,
      sum(is_post)::bigint AS posts_count,
      sum(is_comment)::bigint AS direct_comments_count,
      sum(is_reply)::bigint AS replies_rows_count,
      sum(is_subcomment)::bigint AS subcomments_count,
      count(*) FILTER (WHERE is_post = 0 AND is_comment = 0 AND is_reply = 0 AND is_subcomment = 0)::bigint AS other_records_count,
      count(*) FILTER (WHERE sentiment_key = 'positive')::bigint AS positive_count,
      count(*) FILTER (WHERE sentiment_key = 'negative')::bigint AS negative_count,
      count(*) FILTER (WHERE sentiment_key = 'neutral')::bigint AS neutral_count,
      count(*) FILTER (WHERE sentiment_key IN ('positive', 'negative', 'neutral'))::bigint AS classified_count,
      count(*) FILTER (WHERE sentiment_key = 'pending')::bigint AS pending_count,
      coalesce(sum(likes_count), 0)::bigint AS total_likes,
      coalesce(sum(comments_replies_engagement), 0)::bigint AS total_replies,
      coalesce(sum(shares_count), 0)::bigint AS total_shares,
      coalesce(sum(engagement), 0)::bigint AS metric_engagement
    FROM scored
  ), network_breakdown AS (
    SELECT network, count(*)::bigint AS total
    FROM scored
    GROUP BY network
  ), engagement_by_network AS (
    SELECT
      network AS rede,
      count(*)::bigint AS registros,
      coalesce(sum(likes_count), 0)::bigint AS curtidas,
      coalesce(sum(comments_replies_engagement), 0)::bigint AS comentarios_respostas,
      coalesce(sum(shares_count), 0)::bigint AS compartilhamentos,
      coalesce(sum(engagement), 0)::bigint AS engajamento
    FROM scored
    GROUP BY network
    ORDER BY engajamento DESC, registros DESC, network ASC
  ), sentiment_by_network AS (
    SELECT
      network AS rede,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE sentiment_key = 'positive')::bigint AS positivo,
      count(*) FILTER (WHERE sentiment_key = 'neutral')::bigint AS neutro,
      count(*) FILTER (WHERE sentiment_key = 'negative')::bigint AS negativo,
      count(*) FILTER (WHERE sentiment_key = 'pending')::bigint AS sem_classificacao
    FROM scored
    GROUP BY network
    ORDER BY total DESC, network ASC
  ), activity_hour_week AS (
    SELECT
      extract(dow FROM activity_at)::int AS dia_semana,
      extract(hour FROM activity_at)::int AS hora,
      count(*)::bigint AS registros,
      coalesce(sum(engagement), 0)::bigint AS engajamento
    FROM scored
    WHERE activity_at IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  ), theme_patterns AS (
    SELECT * FROM (VALUES
      ('economia', ARRAY['economia','econôm','preço','preços','inflação','emprego','desemprego','salário','renda','mercado','crescimento','custo de vida','juros','pib']::text[]),
      ('segurança', ARRAY['segurança','crime','violência','polícia','homicídio','roubo','assalto','tráfico','facção','criminalidade','insegurança']::text[]),
      ('saúde', ARRAY['saúde','hospital','sus','médico','médica','remédio','vacina','fila da regulação','regulação','atendimento','doença']::text[]),
      ('educação', ARRAY['educação','escola','professor','professora','aluno','ensino','universidade','creche','faculdade','enem']::text[]),
      ('corrupção', ARRAY['corrupção','corrupto','corrupta','propina','roubo público','desvio','mensalão','rachadinha','lava jato','fraude']::text[]),
      ('eleições', ARRAY['eleição','eleições','voto','votar','urna','pesquisa','campanha','candidato','presidente','governador','prefeito','senador','deputado','mandato','segundo turno']::text[]),
      ('impostos', ARRAY['imposto','impostos','taxa','taxação','tributo','tributária','isenção','arrecadação','receita federal']::text[]),
      ('infraestrutura', ARRAY['obra','obras','estrada','transporte','ônibus','metrô','saneamento','moradia','habitação','energia','água']::text[]),
      ('programas sociais', ARRAY['bolsa família','auxílio','benefício','social','pobreza','fome','cadúnico','assistência']::text[]),
      ('meio ambiente', ARRAY['meio ambiente','ambiental','amazônia','clima','desmatamento','queimada','sustentabilidade','enchente']::text[])
    ) AS p(theme, keywords)
  ), theme_hits AS (
    SELECT p.theme, count(*)::bigint AS mentions
    FROM scored s
    JOIN theme_patterns p ON EXISTS (
      SELECT 1 FROM unnest(p.keywords) kw
      WHERE lower(coalesce(s.comment_text, '')) LIKE '%' || kw || '%'
    )
    GROUP BY p.theme
    ORDER BY mentions DESC, p.theme ASC
    LIMIT 8
  ), top_posts AS (
    SELECT
      id,
      network AS social_network,
      likes_count,
      comments_replies_engagement AS replies_count,
      shares_count,
      CASE
        WHEN sentiment_key = 'positive' THEN 'Positivo'
        WHEN sentiment_key = 'negative' THEN 'Negativo'
        WHEN sentiment_key = 'neutral' THEN 'Neutro'
        ELSE NULL
      END AS sentiment_label,
      filter_at AS collected_at,
      engagement
    FROM scored
    ORDER BY engagement DESC, filter_at DESC NULLS LAST
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'totalRecords', coalesce(a.total_records, 0),
    'postsCount', coalesce(a.posts_count, 0),
    'commentsCount', coalesce(a.direct_comments_count, 0) + coalesce(a.replies_rows_count, 0) + coalesce(a.subcomments_count, 0),
    'directCommentsCount', coalesce(a.direct_comments_count, 0),
    'repliesRowsCount', coalesce(a.replies_rows_count, 0),
    'subcommentsCount', coalesce(a.subcomments_count, 0),
    'otherRecordsCount', coalesce(a.other_records_count, 0),
    'positiveCount', coalesce(a.positive_count, 0),
    'negativeCount', coalesce(a.negative_count, 0),
    'neutralCount', coalesce(a.neutral_count, 0),
    'classifiedCount', coalesce(a.classified_count, 0),
    'pendingCount', coalesce(a.pending_count, 0),
    'totalLikes', coalesce(a.total_likes, 0),
    'totalReplies', coalesce(a.total_replies, 0),
    'totalShares', coalesce(a.total_shares, 0),
    'totalInteractions', coalesce(a.metric_engagement, 0),
    'dominantTopics', coalesce((SELECT jsonb_agg(jsonb_build_object('topic', theme, 'mentions', mentions)) FROM theme_hits), '[]'::jsonb),
    'networkBreakdown', coalesce((SELECT jsonb_agg(jsonb_build_object('network', network, 'total', total) ORDER BY total DESC, network ASC) FROM network_breakdown), '[]'::jsonb),
    'engagementByNetwork', coalesce((SELECT jsonb_agg(to_jsonb(engagement_by_network.*)) FROM engagement_by_network), '[]'::jsonb),
    'sentimentByNetwork', coalesce((SELECT jsonb_agg(to_jsonb(sentiment_by_network.*)) FROM sentiment_by_network), '[]'::jsonb),
    'activityHourWeek', coalesce((SELECT jsonb_agg(to_jsonb(activity_hour_week.*)) FROM activity_hour_week), '[]'::jsonb),
    'debug', jsonb_build_object(
      'postsEncontrados', coalesce(a.posts_count, 0),
      'comentariosEncontrados', coalesce(a.direct_comments_count, 0),
      'respostasEncontradas', coalesce(a.replies_rows_count, 0),
      'subcomentariosEncontrados', coalesce(a.subcomments_count, 0),
      'outrosRegistrosEncontrados', coalesce(a.other_records_count, 0),
      'redesEncontradas', (SELECT count(*) FROM network_breakdown),
      'registrosPorRede', coalesce((SELECT jsonb_object_agg(network, total ORDER BY network) FROM network_breakdown), '{}'::jsonb)
    ),
    'topPosts', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'social_network', social_network,
      'likes_count', likes_count,
      'replies_count', replies_count,
      'shares_count', shares_count,
      'sentiment_label', sentiment_label,
      'collected_at', collected_at,
      'engagement', engagement
    )) FROM top_posts), '[]'::jsonb)
  ) INTO v_result
  FROM agg a;

  RETURN coalesce(v_result, jsonb_build_object(
    'totalRecords', 0,
    'postsCount', 0,
    'commentsCount', 0,
    'directCommentsCount', 0,
    'repliesRowsCount', 0,
    'subcommentsCount', 0,
    'otherRecordsCount', 0,
    'positiveCount', 0,
    'negativeCount', 0,
    'neutralCount', 0,
    'classifiedCount', 0,
    'pendingCount', 0,
    'totalLikes', 0,
    'totalReplies', 0,
    'totalShares', 0,
    'totalInteractions', 0,
    'dominantTopics', '[]'::jsonb,
    'networkBreakdown', '[]'::jsonb,
    'engagementByNetwork', '[]'::jsonb,
    'sentimentByNetwork', '[]'::jsonb,
    'activityHourWeek', '[]'::jsonb,
    'debug', jsonb_build_object(
      'postsEncontrados', 0,
      'comentariosEncontrados', 0,
      'respostasEncontradas', 0,
      'subcomentariosEncontrados', 0,
      'outrosRegistrosEncontrados', 0,
      'redesEncontradas', 0,
      'registrosPorRede', '{}'::jsonb
    ),
    'topPosts', '[]'::jsonb
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO service_role;