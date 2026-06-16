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
  v_since timestamptz := current_date::timestamptz - (v_days - 1) * interval '1 day';
  v_prev_since timestamptz := current_date::timestamptz - ((v_days * 2) - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_data jsonb;
  v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.');
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      si.id,
      public.nv_network_key(si.social_network) AS network,
      COALESCE(NULLIF(si.comment_text,''), NULLIF(si.post_title,''), NULLIF(si.post_description,''), 'Sem texto disponível') AS display_text,
      public.nv_clean_text(concat_ws(' ', si.post_title, si.post_description, si.comment_text)) AS text_blob,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
      GREATEST(COALESCE(si.likes_count,0),0)::bigint AS likes,
      GREATEST(COALESCE(si.replies_count,0),0)::bigint AS replies,
      GREATEST(COALESCE(si.shares_count,0),0)::bigint AS shares,
      GREATEST(COALESCE(si.engagement_score,0),0)::bigint AS engagement_score,
      GREATEST(
        COALESCE(si.engagement_score,0)::bigint - (
          GREATEST(COALESCE(si.likes_count,0),0)::bigint +
          GREATEST(COALESCE(si.replies_count,0),0)::bigint +
          GREATEST(COALESCE(si.shares_count,0),0)::bigint
        ),
        0
      )::bigint AS views,
      (
        GREATEST(COALESCE(si.likes_count,0),0)::numeric +
        2 * GREATEST(COALESCE(si.replies_count,0),0)::numeric +
        3 * GREATEST(COALESCE(si.shares_count,0),0)::numeric +
        0.1 * GREATEST(
          COALESCE(si.engagement_score,0)::numeric - (
            GREATEST(COALESCE(si.likes_count,0),0)::numeric +
            GREATEST(COALESCE(si.replies_count,0),0)::numeric +
            GREATEST(COALESCE(si.shares_count,0),0)::numeric
          ),
          0
        )
      ) AS score,
      (
        GREATEST(COALESCE(si.likes_count,0),0)::bigint +
        GREATEST(COALESCE(si.replies_count,0),0)::bigint +
        GREATEST(COALESCE(si.shares_count,0),0)::bigint
      ) AS engagement,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS post_key,
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      si.collected_at,
      si.post_url,
      si.thumbnail_url,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), 'anônimo') AS comment_author
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
  ), current_base AS MATERIALIZED (
    SELECT * FROM base WHERE ts >= v_since
  ), previous_base AS MATERIALIZED (
    SELECT * FROM base WHERE ts < v_since
  ), kpis AS (
    SELECT
      count(*)::bigint AS total,
      count(DISTINCT NULLIF(comment_author,'anônimo'))::bigint AS authors,
      COALESCE(sum(engagement),0)::bigint AS engagement,
      COALESCE(sum(likes),0)::bigint AS likes,
      COALESCE(sum(replies),0)::bigint AS replies,
      COALESCE(sum(shares),0)::bigint AS shares,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM previous_base) AS prev_total,
      (SELECT count(*)::bigint FROM previous_base WHERE sent = 'positive') AS prev_pos,
      (SELECT count(*)::bigint FROM previous_base WHERE sent = 'negative') AS prev_neg,
      (SELECT count(*)::bigint FROM previous_base WHERE sent = 'neutral') AS prev_neu
    FROM current_base
  ), series AS (
    SELECT to_char(ts::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS u
    FROM current_base
    GROUP BY ts::date
  ), by_net AS (
    SELECT network,
      count(*)::bigint AS mentions,
      COALESCE(sum(likes),0)::bigint AS likes,
      COALESCE(sum(replies),0)::bigint AS replies,
      COALESCE(sum(shares),0)::bigint AS shares,
      COALESCE(sum(engagement),0)::bigint AS engagement,
      (count(*)::numeric * 0.4 + COALESCE(sum(engagement),0)::numeric * 0.6) AS dominance
    FROM current_base
    GROUP BY network
  ), heat AS (
    SELECT extract(dow FROM ts)::int AS dow, extract(hour FROM ts)::int AS hr, count(*)::bigint AS c
    FROM current_base
    GROUP BY 1,2
  ), themed AS MATERIALIZED (
    SELECT *, CASE
      WHEN text_blob ~ '(econom|inflaç|inflac|emprego|salári|salari|renda|imposto|tribut|preço|preco|juros?|pib|custo de vida)' THEN 'economia'
      WHEN text_blob ~ '(segurança|seguranca|crime|violência|violencia|polícia|policia|tráfic|trafic|assalt|homicíd|homicid|facç|facc|milíci|milici)' THEN 'segurança'
      WHEN text_blob ~ '(saúde|saude|hospital|sus|médic|medic|vacin|remédi|remedi|doenç|doenc)' THEN 'saúde'
      WHEN text_blob ~ '(educaç|educac|escola|professor|aluno|ensino|universidad|enem|creche)' THEN 'educação'
      WHEN text_blob ~ '(corrupç|corrupc|propina|desvio|fraud|rachadinha|lava jato)' THEN 'corrupção'
      WHEN text_blob ~ '(eleiç|eleic|voto|votar|urna|campanha|candidat|presidente|governador|prefeito|senador|deputado)' THEN 'eleições'
      WHEN text_blob ~ '(obra|estrada|transport|ônibus|onibus|metrô|metro|sanea|moradia|habit)' THEN 'infraestrutura'
      WHEN text_blob ~ '(bolsa famíli|bolsa famili|auxíli|auxili|benefíci|benefici|pobreza|fome|cadúnico|cadunico)' THEN 'programas sociais'
      WHEN text_blob ~ '(meio ambient|amazôni|amazoni|clima|desmatament|queimad|enchent)' THEN 'meio ambiente'
      WHEN text_blob ~ '(justiça|justica|stf|supremo|congresso|câmara|camara|senado|pl|pec|lei|judiciári|judiciari)' THEN 'institucional'
      ELSE NULL END AS theme
    FROM current_base
  ), themed_prev AS MATERIALIZED (
    SELECT *, CASE
      WHEN text_blob ~ '(econom|inflaç|inflac|emprego|salári|salari|renda|imposto|tribut|preço|preco|juros?|pib|custo de vida)' THEN 'economia'
      WHEN text_blob ~ '(segurança|seguranca|crime|violência|violencia|polícia|policia|tráfic|trafic|assalt|homicíd|homicid|facç|facc|milíci|milici)' THEN 'segurança'
      WHEN text_blob ~ '(saúde|saude|hospital|sus|médic|medic|vacin|remédi|remedi|doenç|doenc)' THEN 'saúde'
      WHEN text_blob ~ '(educaç|educac|escola|professor|aluno|ensino|universidad|enem|creche)' THEN 'educação'
      WHEN text_blob ~ '(corrupç|corrupc|propina|desvio|fraud|rachadinha|lava jato)' THEN 'corrupção'
      WHEN text_blob ~ '(eleiç|eleic|voto|votar|urna|campanha|candidat|presidente|governador|prefeito|senador|deputado)' THEN 'eleições'
      WHEN text_blob ~ '(obra|estrada|transport|ônibus|onibus|metrô|metro|sanea|moradia|habit)' THEN 'infraestrutura'
      WHEN text_blob ~ '(bolsa famíli|bolsa famili|auxíli|auxili|benefíci|benefici|pobreza|fome|cadúnico|cadunico)' THEN 'programas sociais'
      WHEN text_blob ~ '(meio ambient|amazôni|amazoni|clima|desmatament|queimad|enchent)' THEN 'meio ambiente'
      WHEN text_blob ~ '(justiça|justica|stf|supremo|congresso|câmara|camara|senado|pl|pec|lei|judiciári|judiciari)' THEN 'institucional'
      ELSE NULL END AS theme
    FROM previous_base
  ), topics AS (
    SELECT
      t.theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE t.sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE t.sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE t.sent = 'neutral')::bigint AS neu,
      COALESCE((SELECT count(*)::bigint FROM themed_prev p WHERE p.theme = t.theme),0)::bigint AS prev_mentions
    FROM themed t
    WHERE t.theme IS NOT NULL
    GROUP BY t.theme
    ORDER BY mentions DESC
    LIMIT 20
  ), hashtag_matches AS MATERIALIZED (
    SELECT
      public.nv_hashtag_display(public.nv_normalize_hashtag((m.match)[1])) AS tag,
      b.sent,
      b.ts
    FROM current_base b
    CROSS JOIN LATERAL regexp_matches(b.text_blob, '#([[:alnum:]_áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ]{2,40})', 'g') AS m(match)
  ), hashtag_prev_matches AS MATERIALIZED (
    SELECT public.nv_hashtag_display(public.nv_normalize_hashtag((m.match)[1])) AS tag
    FROM previous_base b
    CROSS JOIN LATERAL regexp_matches(b.text_blob, '#([[:alnum:]_áàãâäéèêëíìîïóòõôöúùûüçñÁÀÃÂÄÉÈÊËÍÌÎÏÓÒÕÔÖÚÙÛÜÇÑ]{2,40})', 'g') AS m(match)
  ), hashtags AS (
    SELECT
      h.tag,
      count(*)::bigint AS c,
      count(*) FILTER (WHERE h.sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE h.sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE h.sent = 'neutral')::bigint AS neu,
      COALESCE((SELECT count(*)::bigint FROM hashtag_prev_matches p WHERE p.tag = h.tag),0)::bigint AS prev_c
    FROM hashtag_matches h
    WHERE h.tag IS NOT NULL AND public.nv_is_valid_hashtag(h.tag)
    GROUP BY h.tag
    ORDER BY c DESC
    LIMIT 20
  ), top_dedup AS (
    SELECT DISTINCT ON (post_key) *
    FROM current_base
    WHERE engagement > 0
    ORDER BY post_key, score DESC, ts DESC
  ), top_posts AS (
    SELECT * FROM top_dedup
    ORDER BY score DESC, ts DESC
    LIMIT 10
  ), debug AS (
    SELECT
      (SELECT count(*)::bigint FROM current_base) AS mentions,
      (SELECT count(DISTINCT post_key)::bigint FROM current_base) AS posts,
      (SELECT count(*)::bigint FROM current_base WHERE sent IS NOT NULL) AS classified,
      (SELECT count(*)::bigint FROM topics) AS themes,
      (SELECT count(*)::bigint FROM hashtags) AS hashtags,
      (SELECT count(*)::bigint FROM top_posts) AS top_posts
  )
  SELECT jsonb_build_object(
    'analytics', jsonb_build_object(
      'mentions', (SELECT to_jsonb(kpis.*) FROM kpis),
      'sentiment', jsonb_build_object(
        'positive', (SELECT pos FROM kpis),
        'negative', (SELECT neg FROM kpis),
        'neutral', (SELECT neu FROM kpis),
        'previous_positive', (SELECT prev_pos FROM kpis),
        'previous_negative', (SELECT prev_neg FROM kpis),
        'previous_neutral', (SELECT prev_neu FROM kpis)
      ),
      'engagement', jsonb_build_object(
        'total', (SELECT engagement FROM kpis),
        'likes', (SELECT likes FROM kpis),
        'comments', (SELECT replies FROM kpis),
        'shares', (SELECT shares FROM kpis)
      ),
      'themes', (SELECT COALESCE(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
      'hashtags', (SELECT COALESCE(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags),
      'topPosts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id,
        'social_network', network,
        'comment_text', display_text,
        'comment_author', comment_author,
        'sent', sent,
        'eng', engagement,
        'score', score,
        'likes', likes,
        'replies', replies,
        'shares', shares,
        'views', views,
        'thumbnail_url', thumbnail_url,
        'original_posted_at', ts,
        'collected_at', collected_at,
        'post_url', post_url
      ) ORDER BY score DESC),'[]'::jsonb) FROM top_posts)
    ),
    'kpis', (SELECT to_jsonb(kpis.*) FROM kpis),
    'series', (SELECT COALESCE(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network', (SELECT COALESCE(jsonb_agg(to_jsonb(by_net.*) ORDER BY dominance DESC),'[]'::jsonb) FROM by_net),
    'heatmap', (SELECT COALESCE(jsonb_agg(to_jsonb(heat.*) ORDER BY dow, hr),'[]'::jsonb) FROM heat),
    'hashtags', (SELECT COALESCE(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags),
    'topics', (SELECT COALESCE(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'top_posts', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'social_network', network,
      'comment_text', display_text,
      'comment_author', comment_author,
      'sent', sent,
      'eng', engagement,
      'score', score,
      'likes', likes,
      'replies', replies,
      'shares', shares,
      'views', views,
      'thumbnail_url', thumbnail_url,
      'original_posted_at', ts,
      'collected_at', collected_at,
      'post_url', post_url
    ) ORDER BY score DESC),'[]'::jsonb) FROM top_posts),
    'debug', (SELECT to_jsonb(debug.*) FROM debug)
  ) INTO v_data;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  IF COALESCE((v_data #>> '{debug,top_posts}')::int,0) = 0 AND COALESCE((v_data #>> '{kpis,engagement}')::bigint,0) > 0 THEN
    RAISE WARNING 'TOP_POSTS_PIPELINE_FAILED user=% candidate=% network=% days=% engagement=% mentions=%', v_uid, p_candidate_id, v_network, v_days, v_data #>> '{kpis,engagement}', v_data #>> '{kpis,total}';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_data,
    'diagnostics', jsonb_build_object(
      'cache_hit', false,
      'source', 'social_interactions_ssot',
      'duration_ms', v_duration,
      'debug', v_data->'debug',
      'ai_prompt_guardrail', 'Use SOMENTE o analytics JSON atual. Não use cache. Não use memória. Não invente métricas.'
    )
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar a visão por rede social.', 'error', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.network_view_analytics(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_view_analytics(uuid,text,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.network_view_top_posts(
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
  v_since timestamptz := current_date::timestamptz - (v_days - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_data jsonb;
  v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.');
  END IF;

  WITH base AS MATERIALIZED (
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
        ),
        0
      )::bigint AS views,
      (
        GREATEST(COALESCE(si.likes_count,0),0)::bigint +
        GREATEST(COALESCE(si.replies_count,0),0)::bigint +
        GREATEST(COALESCE(si.shares_count,0),0)::bigint
      ) AS eng,
      (
        GREATEST(COALESCE(si.likes_count,0),0)::numeric +
        2 * GREATEST(COALESCE(si.replies_count,0),0)::numeric +
        3 * GREATEST(COALESCE(si.shares_count,0),0)::numeric +
        0.1 * GREATEST(
          COALESCE(si.engagement_score,0)::numeric - (
            GREATEST(COALESCE(si.likes_count,0),0)::numeric +
            GREATEST(COALESCE(si.replies_count,0),0)::numeric +
            GREATEST(COALESCE(si.shares_count,0),0)::numeric
          ),
          0
        )
      ) AS score,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key,
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS canonical_at,
      si.collected_at,
      si.post_url,
      si.thumbnail_url
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_since
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM base
    WHERE eng > 0
    ORDER BY dedup_key, score DESC, canonical_at DESC
  ), ranked AS (
    SELECT * FROM deduped ORDER BY score DESC, canonical_at DESC LIMIT 10
  )
  SELECT jsonb_build_object(
    'top_posts',
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'social_network', social_network,
      'comment_text', comment_text,
      'comment_author', comment_author,
      'sent', sent,
      'eng', eng,
      'score', score,
      'likes', likes,
      'replies', replies,
      'shares', shares,
      'views', views,
      'thumbnail_url', thumbnail_url,
      'original_posted_at', canonical_at,
      'collected_at', collected_at,
      'post_url', post_url
    ) ORDER BY score DESC), '[]'::jsonb)
  ) INTO v_data
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  IF COALESCE(jsonb_array_length(v_data->'top_posts'),0) = 0 THEN
    RAISE WARNING 'TOP_POSTS_PIPELINE_FAILED user=% candidate=% network=% days=%', v_uid, p_candidate_id, v_network, v_days;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_data,
    'diagnostics', jsonb_build_object('cache_hit', false, 'source', 'social_interactions_ssot', 'duration_ms', v_duration)
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'TOP_POSTS_PIPELINE_FAILED error=%', SQLERRM;
  RETURN jsonb_build_object('ok', true, 'fallback', true, 'data', jsonb_build_object('top_posts','[]'::jsonb), 'diagnostics', jsonb_build_object('error', SQLERRM));
END;
$function$;

REVOKE ALL ON FUNCTION public.network_view_top_posts(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated, service_role;

DELETE FROM public.network_view_cache;

DO $$
BEGIN
  IF to_regclass('public.ai_summary_cache') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.ai_summary_cache';
  END IF;
  IF to_regclass('public.social_analytics_cache') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.social_analytics_cache';
  END IF;
  IF to_regclass('public.candidate_network_cache') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.candidate_network_cache';
  END IF;
END $$;