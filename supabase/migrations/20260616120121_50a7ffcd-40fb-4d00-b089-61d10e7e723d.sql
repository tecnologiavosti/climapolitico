CREATE OR REPLACE FUNCTION public.network_view_analytics(
  p_candidate_id uuid DEFAULT NULL::uuid,
  p_network text DEFAULT NULL::text,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since date := current_date - (v_days - 1);
  v_prev_since date := current_date - ((v_days * 2) - 1);
  v_started timestamptz := clock_timestamp();
  v_data jsonb;
  v_kpis jsonb;
  v_series jsonb;
  v_by_net jsonb;
  v_heat jsonb;
  v_topics jsonb;
  v_hashtags jsonb;
  v_top_posts jsonb;
  v_debug jsonb;
  v_duration int := 0;
  v_total bigint := 0;
  v_engagement bigint := 0;
  v_top_count int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.');
  END IF;

  -- KPIs + by_network + series a partir de social_metrics_daily (SSOT diário)
  WITH src AS (
    SELECT *, (date >= v_since) AS is_current
    FROM public.social_metrics_daily
    WHERE date >= v_prev_since AND date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
  ), kpis AS (
    SELECT
      coalesce(sum(mentions) FILTER (WHERE is_current),0)::bigint AS total,
      coalesce(sum(unique_authors) FILTER (WHERE is_current),0)::bigint AS authors,
      coalesce(sum(likes + comments + shares) FILTER (WHERE is_current),0)::bigint AS engagement,
      coalesce(sum(likes) FILTER (WHERE is_current),0)::bigint AS likes,
      coalesce(sum(comments) FILTER (WHERE is_current),0)::bigint AS replies,
      coalesce(sum(shares) FILTER (WHERE is_current),0)::bigint AS shares,
      coalesce(sum(positive) FILTER (WHERE is_current),0)::bigint AS pos,
      coalesce(sum(negative) FILTER (WHERE is_current),0)::bigint AS neg,
      coalesce(sum(neutral) FILTER (WHERE is_current),0)::bigint AS neu,
      coalesce(sum(mentions) FILTER (WHERE NOT is_current),0)::bigint AS prev_total,
      coalesce(sum(positive) FILTER (WHERE NOT is_current),0)::bigint AS prev_pos,
      coalesce(sum(negative) FILTER (WHERE NOT is_current),0)::bigint AS prev_neg,
      coalesce(sum(neutral) FILTER (WHERE NOT is_current),0)::bigint AS prev_neu
    FROM src
  ), series AS (
    SELECT to_char(date,'YYYY-MM-DD') AS day,
      sum(positive)::bigint AS p, sum(negative)::bigint AS n, sum(neutral)::bigint AS u
    FROM src WHERE is_current GROUP BY 1
  ), by_net AS (
    SELECT network,
      sum(mentions)::bigint AS mentions,
      sum(likes)::bigint AS likes,
      sum(comments)::bigint AS replies,
      sum(shares)::bigint AS shares,
      sum(likes + comments + shares)::bigint AS engagement,
      (sum(mentions)::numeric * 0.4 + sum(likes + comments + shares)::numeric * 0.6) AS dominance
    FROM src WHERE is_current GROUP BY 1
  )
  SELECT
    to_jsonb(kpis.*),
    (SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    (SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY dominance DESC),'[]'::jsonb) FROM by_net)
  INTO v_kpis, v_series, v_by_net
  FROM kpis;

  v_total := coalesce((v_kpis->>'total')::bigint, 0);
  v_engagement := coalesce((v_kpis->>'engagement')::bigint, 0);

  -- Heatmap
  SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hr', hr, 'c', c) ORDER BY dow, hr),'[]'::jsonb)
  INTO v_heat
  FROM (
    SELECT dow::int AS dow, hr::int AS hr, sum(mentions)::bigint AS c
    FROM public.daily_heatmap_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1,2
  ) h;

  -- Tópicos
  WITH cur AS (
    SELECT theme,
      sum(mentions)::bigint AS mentions,
      sum(positive_count)::bigint AS pos,
      sum(negative_count)::bigint AS neg,
      sum(neutral_count)::bigint AS neu
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND theme IS NOT NULL
    GROUP BY theme
  ), prev AS (
    SELECT theme, sum(mentions)::bigint AS prev_mentions
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND theme IS NOT NULL
    GROUP BY theme
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'theme', c.theme, 'mentions', c.mentions, 'pos', c.pos, 'neg', c.neg, 'neu', c.neu,
    'prev_mentions', coalesce(p.prev_mentions,0)
  ) ORDER BY c.mentions DESC),'[]'::jsonb)
  INTO v_topics
  FROM cur c LEFT JOIN prev p USING (theme)
  WHERE c.mentions > 0;

  -- Hashtags
  WITH cur AS (
    SELECT tag,
      sum(mentions)::bigint AS c,
      sum(positive_count)::bigint AS pos,
      sum(negative_count)::bigint AS neg,
      sum(neutral_count)::bigint AS neu
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND tag IS NOT NULL
      AND public.nv_is_valid_hashtag(tag)
    GROUP BY tag
  ), prev AS (
    SELECT tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND tag IS NOT NULL
    GROUP BY tag
  ), ranked AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0) AS prev_c
    FROM cur c LEFT JOIN prev p USING (tag)
    ORDER BY c.c DESC
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'tag', CASE WHEN tag LIKE '#%' THEN tag ELSE '#'||tag END,
    'c', c, 'pos', pos, 'neg', neg, 'neu', neu, 'prev_c', prev_c
  ) ORDER BY c DESC),'[]'::jsonb)
  INTO v_hashtags FROM ranked;

  -- Top posts: consulta focada por janela curta (usa idx_si_nv_user_candidate_published_engagement)
  WITH base AS (
    SELECT
      si.id,
      public.nv_network_key(si.social_network) AS social_network,
      COALESCE(NULLIF(si.comment_text,''), NULLIF(si.post_title,''), NULLIF(si.post_description,''), 'Sem texto disponível') AS comment_text,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), 'anônimo') AS comment_author,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
      GREATEST(COALESCE(si.likes_count,0),0)::bigint AS likes,
      GREATEST(COALESCE(si.replies_count,0),0)::bigint AS replies,
      GREATEST(COALESCE(si.shares_count,0),0)::bigint AS shares,
      GREATEST(
        COALESCE(si.engagement_score,0)::bigint - (
          GREATEST(COALESCE(si.likes_count,0),0)::bigint +
          GREATEST(COALESCE(si.replies_count,0),0)::bigint +
          GREATEST(COALESCE(si.shares_count,0),0)::bigint
        ), 0
      )::bigint AS views,
      (
        GREATEST(COALESCE(si.likes_count,0),0)::numeric +
        2 * GREATEST(COALESCE(si.replies_count,0),0)::numeric +
        3 * GREATEST(COALESCE(si.shares_count,0),0)::numeric
      ) AS score,
      (GREATEST(COALESCE(si.likes_count,0),0) + GREATEST(COALESCE(si.replies_count,0),0) + GREATEST(COALESCE(si.shares_count,0),0))::bigint AS eng,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS post_key,
      COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      si.collected_at, si.post_url, si.thumbnail_url
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND si.original_posted_at IS NOT NULL
      AND si.original_posted_at >= v_since::timestamptz
      AND si.original_posted_at <= now()
      AND si.comment_text IS NOT NULL
      AND (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0)) > 0
    ORDER BY si.original_posted_at DESC
    LIMIT 5000
  ), deduped AS (
    SELECT DISTINCT ON (post_key) * FROM base ORDER BY post_key, score DESC, ts DESC
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'social_network', social_network, 'comment_text', comment_text,
    'comment_author', comment_author, 'sent', sent, 'eng', eng, 'score', score,
    'likes', likes, 'replies', replies, 'shares', shares, 'views', views,
    'thumbnail_url', thumbnail_url, 'original_posted_at', ts,
    'collected_at', collected_at, 'post_url', post_url
  ) ORDER BY score DESC),'[]'::jsonb)
  INTO v_top_posts
  FROM (SELECT * FROM deduped ORDER BY score DESC LIMIT 10) sub;

  v_top_count := COALESCE(jsonb_array_length(v_top_posts), 0);

  IF v_top_count = 0 AND v_engagement > 0 THEN
    RAISE WARNING 'TOP_POSTS_PIPELINE_FAILED user=% candidate=% network=% days=% engagement=% mentions=%',
      v_uid, p_candidate_id, v_network, v_days, v_engagement, v_total;
  END IF;

  v_debug := jsonb_build_object(
    'mentions', v_total,
    'posts', v_total,
    'classified', coalesce((v_kpis->>'pos')::bigint,0) + coalesce((v_kpis->>'neg')::bigint,0) + coalesce((v_kpis->>'neu')::bigint,0),
    'themes', COALESCE(jsonb_array_length(v_topics),0),
    'hashtags', COALESCE(jsonb_array_length(v_hashtags),0),
    'top_posts', v_top_count
  );

  v_data := jsonb_build_object(
    'kpis', v_kpis,
    'series', v_series,
    'by_network', v_by_net,
    'heatmap', v_heat,
    'topics', v_topics,
    'hashtags', v_hashtags,
    'top_posts', v_top_posts,
    'debug', v_debug,
    'analytics', jsonb_build_object(
      'mentions', v_kpis,
      'engagement', jsonb_build_object(
        'total', coalesce((v_kpis->>'engagement')::bigint,0),
        'likes', coalesce((v_kpis->>'likes')::bigint,0),
        'comments', coalesce((v_kpis->>'replies')::bigint,0),
        'shares', coalesce((v_kpis->>'shares')::bigint,0)
      ),
      'sentiment', jsonb_build_object(
        'positive', coalesce((v_kpis->>'pos')::bigint,0),
        'negative', coalesce((v_kpis->>'neg')::bigint,0),
        'neutral', coalesce((v_kpis->>'neu')::bigint,0)
      ),
      'themes', v_topics,
      'hashtags', v_hashtags,
      'topPosts', v_top_posts
    )
  );

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_data,
    'diagnostics', jsonb_build_object(
      'cache_hit', false,
      'source', 'social_metrics_daily+social_interactions',
      'duration_ms', v_duration,
      'debug', v_debug,
      'ai_prompt_guardrail', 'Use SOMENTE o analytics JSON atual. Não use cache. Não use memória. Não invente métricas.'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar a visão por rede social.', 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.network_view_analytics(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_view_analytics(uuid,text,integer) TO authenticated, service_role;

DELETE FROM public.network_view_cache;