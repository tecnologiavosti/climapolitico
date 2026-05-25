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

  WITH filtered AS (
    SELECT
      si.id,
      si.comment_text,
      si.social_network,
      lower(coalesce(si.interaction_type, 'comment')) AS interaction_type,
      si.sentiment_label,
      coalesce(si.likes_count, 0) AS likes_count,
      coalesce(si.replies_count, 0) AS replies_count,
      coalesce(si.shares_count, 0) AS shares_count
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network, '')) NOT IN ('mastodon', 'lemmy', 'pinterest', 'gdelt')
  ), agg AS (
    SELECT
      count(*)::bigint AS total_records,
      count(*) FILTER (WHERE interaction_type IN ('post', 'mention', 'tweet', 'news', 'video', 'article', 'section', 'related', 'revision'))::bigint AS posts_count,
      count(*) FILTER (WHERE interaction_type IN ('comment', 'reply', 'subcomment', 'response'))::bigint AS comments_count,
      count(*) FILTER (WHERE sentiment_label IN ('Positivo', 'positive', 'POSITIVE'))::bigint AS positive_count,
      count(*) FILTER (WHERE sentiment_label IN ('Negativo', 'negative', 'NEGATIVE'))::bigint AS negative_count,
      count(*) FILTER (WHERE sentiment_label IN ('Neutro', 'neutral', 'NEUTRAL'))::bigint AS neutral_count,
      count(*) FILTER (WHERE sentiment_label IN ('Positivo', 'positive', 'POSITIVE', 'Negativo', 'negative', 'NEGATIVE', 'Neutro', 'neutral', 'NEUTRAL'))::bigint AS classified_count,
      count(*) FILTER (WHERE sentiment_label IS NULL OR sentiment_label NOT IN ('Positivo', 'positive', 'POSITIVE', 'Negativo', 'negative', 'NEGATIVE', 'Neutro', 'neutral', 'NEUTRAL'))::bigint AS pending_count,
      coalesce(sum(likes_count), 0)::bigint AS total_likes,
      coalesce(sum(replies_count), 0)::bigint AS total_replies,
      coalesce(sum(shares_count), 0)::bigint AS total_shares
    FROM filtered
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
    FROM filtered f
    JOIN theme_patterns p ON EXISTS (
      SELECT 1 FROM unnest(p.keywords) kw
      WHERE lower(coalesce(f.comment_text, '')) LIKE '%' || kw || '%'
    )
    GROUP BY p.theme
    ORDER BY mentions DESC, p.theme ASC
    LIMIT 8
  ), network_hits AS (
    SELECT coalesce(nullif(social_network, ''), 'outro') AS network, count(*)::bigint AS total
    FROM filtered
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 12
  )
  SELECT jsonb_build_object(
    'totalRecords', coalesce(a.total_records, 0),
    'postsCount', coalesce(a.posts_count, 0),
    'commentsCount', coalesce(a.comments_count, 0),
    'positiveCount', coalesce(a.positive_count, 0),
    'negativeCount', coalesce(a.negative_count, 0),
    'neutralCount', coalesce(a.neutral_count, 0),
    'classifiedCount', coalesce(a.classified_count, 0),
    'pendingCount', coalesce(a.pending_count, 0),
    'totalLikes', coalesce(a.total_likes, 0),
    'totalReplies', coalesce(a.total_replies, 0),
    'totalShares', coalesce(a.total_shares, 0),
    'totalInteractions', coalesce(a.total_likes, 0) + coalesce(a.total_replies, 0) + coalesce(a.total_shares, 0),
    'dominantTopics', coalesce((SELECT jsonb_agg(jsonb_build_object('topic', theme, 'mentions', mentions)) FROM theme_hits), '[]'::jsonb),
    'networkBreakdown', coalesce((SELECT jsonb_agg(jsonb_build_object('network', network, 'total', total)) FROM network_hits), '[]'::jsonb)
  ) INTO v_result
  FROM agg a;

  RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_pending_sentiment_jobs(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL,
  _batch_size integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_enqueued integer := 0;
  v_pending_remaining integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH picked AS (
    SELECT si.id, si.candidate_id, si.user_id
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.comment_text IS NOT NULL
      AND length(trim(si.comment_text)) > 0
      AND (si.sentiment_label IS NULL OR si.sentiment_label NOT IN ('Positivo','positive','POSITIVE','Negativo','negative','NEGATIVE','Neutro','neutral','NEUTRAL'))
      AND coalesce(si.analysis_attempts, 0) < 5
      AND NOT EXISTS (
        SELECT 1 FROM public.analysis_jobs j
        WHERE j.related_id = si.id
          AND j.job_type = 'sentiment'
          AND j.status IN ('queued', 'leased', 'running')
      )
    ORDER BY coalesce(si.collected_at, si.created_at) DESC NULLS LAST, si.id
    LIMIT greatest(1, least(coalesce(_batch_size, 1000), 5000))
  ), inserted AS (
    INSERT INTO public.analysis_jobs (job_type, payload, related_id, candidate_id, user_id, priority)
    SELECT 'sentiment', jsonb_build_object('interaction_id', id), id, candidate_id, user_id, 5
    FROM picked
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_enqueued FROM inserted;

  SELECT count(*)::integer INTO v_pending_remaining
  FROM public.social_interactions si
  WHERE (v_is_admin OR si.user_id = _user_id)
    AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
    AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
    AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
    AND si.comment_text IS NOT NULL
    AND length(trim(si.comment_text)) > 0
    AND (si.sentiment_label IS NULL OR si.sentiment_label NOT IN ('Positivo','positive','POSITIVE','Negativo','negative','NEGATIVE','Neutro','neutral','NEUTRAL'));

  RETURN jsonb_build_object('enqueued', v_enqueued, 'pendingRemaining', v_pending_remaining);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pending_sentiment_jobs(uuid, uuid, timestamptz, timestamptz, integer) TO authenticated;