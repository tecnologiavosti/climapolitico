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
  v_is_total_period boolean := greatest(1, least(coalesce(p_days,30), 3650)) >= 3650;
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := (current_date - (v_days - 1))::timestamptz;
  v_prev_since timestamptz := (current_date - ((v_days * 2) - 1))::timestamptz;
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
  v_total_raw bigint := 0;
  v_after_invalid bigint := 0;
  v_after_period bigint := 0;
  v_after_candidate bigint := 0;
  v_after_platform bigint := 0;
  v_after_dedup bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.');
  END IF;

  DROP TABLE IF EXISTS pg_temp.nv_current_rows;
  DROP TABLE IF EXISTS pg_temp.nv_previous_rows;

  CREATE TEMP TABLE nv_current_rows ON COMMIT DROP AS
  SELECT
    si.id,
    si.user_id,
    si.candidate_id,
    public.nv_network_key(si.social_network) AS network,
    COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
    COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), NULLIF(si.author_profile_url,''), si.id::text) AS author_key,
    COALESCE(NULLIF(si.comment_text,''), NULLIF(si.post_title,''), NULLIF(si.post_description,''), 'Sem texto disponível') AS display_text,
    COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), 'anônimo') AS display_author,
    concat_ws(' ', si.post_title, si.post_description, si.comment_text) AS full_text,
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
    COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
    COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS post_key,
    si.collected_at,
    si.post_url,
    si.thumbnail_url
  FROM public.social_interactions si
  WHERE si.invalidated_at IS NULL
    AND (v_is_admin OR si.user_id = v_uid)
    AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
    AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
    AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
    AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
    AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now();

  CREATE TEMP TABLE nv_previous_rows ON COMMIT DROP AS
  SELECT
    COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
    lower(concat_ws(' ', si.post_title, si.post_description, si.comment_text)) AS txt
  FROM public.social_interactions si
  WHERE NOT v_is_total_period
    AND si.invalidated_at IS NULL
    AND (v_is_admin OR si.user_id = v_uid)
    AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
    AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
    AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
    AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since;

  WITH scoped AS (
    SELECT
      si.invalidated_at,
      si.candidate_id,
      public.nv_network_key(si.social_network) AS network_key,
      COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS post_key
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = v_uid)
  )
  SELECT
    count(*)::bigint,
    count(*) FILTER (WHERE invalidated_at IS NULL)::bigint,
    count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now())::bigint,
    count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now() AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id))::bigint,
    count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now() AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id) AND (v_network IS NULL OR network_key = v_network))::bigint,
    count(DISTINCT post_key) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now() AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id) AND (v_network IS NULL OR network_key = v_network))::bigint
  INTO v_total_raw, v_after_invalid, v_after_period, v_after_candidate, v_after_platform, v_after_dedup
  FROM scoped;

  WITH kpis AS (
    SELECT
      count(*)::bigint AS total,
      count(DISTINCT author_key)::bigint AS authors,
      coalesce(sum(likes + replies + shares),0)::bigint AS engagement,
      coalesce(sum(likes),0)::bigint AS likes,
      coalesce(sum(replies),0)::bigint AS replies,
      coalesce(sum(shares),0)::bigint AS shares,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS neu,
      (SELECT count(*) FROM nv_previous_rows)::bigint AS prev_total,
      (SELECT count(*) FILTER (WHERE sent = 'positive') FROM nv_previous_rows)::bigint AS prev_pos,
      (SELECT count(*) FILTER (WHERE sent = 'negative') FROM nv_previous_rows)::bigint AS prev_neg,
      (SELECT count(*) FILTER (WHERE sent NOT IN ('positive','negative')) FROM nv_previous_rows)::bigint AS prev_neu
    FROM nv_current_rows
  ), series AS (
    SELECT to_char(date_trunc('day', ts)::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS u
    FROM nv_current_rows
    GROUP BY 1
  ), by_net AS (
    SELECT network,
      count(*)::bigint AS mentions,
      coalesce(sum(likes),0)::bigint AS likes,
      coalesce(sum(replies),0)::bigint AS replies,
      coalesce(sum(shares),0)::bigint AS shares,
      coalesce(sum(likes + replies + shares),0)::bigint AS engagement,
      (count(*)::numeric * 0.4 + coalesce(sum(likes + replies + shares),0)::numeric * 0.6) AS dominance
    FROM nv_current_rows
    GROUP BY 1
  ), heat AS (
    SELECT extract(dow FROM ts)::int AS dow,
      extract(hour FROM ts)::int AS hr,
      count(*)::bigint AS c
    FROM nv_current_rows
    GROUP BY 1, 2
  )
  SELECT
    to_jsonb(kpis.*),
    (SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    (SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY dominance DESC),'[]'::jsonb) FROM by_net),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hr', hr, 'c', c) ORDER BY dow, hr),'[]'::jsonb) FROM heat)
  INTO v_kpis, v_series, v_by_net, v_heat
  FROM kpis;

  v_total := coalesce((v_kpis->>'total')::bigint, 0);
  v_engagement := coalesce((v_kpis->>'engagement')::bigint, 0);

  WITH cur_topics AS (
    SELECT
      CASE
        WHEN lower(full_text) ~ '(segurança|polícia|crime|violência|milícia|tráfico|prisão)' THEN 'Segurança pública'
        WHEN lower(full_text) ~ '(economia|emprego|inflação|imposto|taxa|preço|mercado|salário)' THEN 'Economia'
        WHEN lower(full_text) ~ '(saúde|sus|hospital|médic|vacina|remédio)' THEN 'Saúde'
        WHEN lower(full_text) ~ '(educação|escola|professor|universidade|enem|creche)' THEN 'Educação'
        WHEN lower(full_text) ~ '(corrupção|propina|rachadinha|escândalo|investigação)' THEN 'Corrupção'
        WHEN lower(full_text) ~ '(eleição|eleições|voto|urna|campanha|candidato|pesquisa)' THEN 'Eleições'
        WHEN lower(full_text) ~ '(obra|transporte|metrô|ônibus|estrada|infraestrutura|moradia)' THEN 'Infraestrutura'
        WHEN lower(full_text) ~ '(ambiente|clima|amazônia|desmatamento|enchente|queimada)' THEN 'Meio ambiente'
        WHEN lower(full_text) ~ '(bolsa família|auxílio|benefício|aposentadoria|inss|social)' THEN 'Programas sociais'
        WHEN lower(full_text) ~ '(stf|justiça|supremo|tribunal|processo|lei|constituição)' THEN 'Justiça'
        ELSE 'Outros'
      END AS theme,
      sent
    FROM nv_current_rows
    WHERE length(full_text) > 0
  ), prev_topics AS (
    SELECT
      CASE
        WHEN txt ~ '(segurança|polícia|crime|violência|milícia|tráfico|prisão)' THEN 'Segurança pública'
        WHEN txt ~ '(economia|emprego|inflação|imposto|taxa|preço|mercado|salário)' THEN 'Economia'
        WHEN txt ~ '(saúde|sus|hospital|médic|vacina|remédio)' THEN 'Saúde'
        WHEN txt ~ '(educação|escola|professor|universidade|enem|creche)' THEN 'Educação'
        WHEN txt ~ '(corrupção|propina|rachadinha|escândalo|investigação)' THEN 'Corrupção'
        WHEN txt ~ '(eleição|eleições|voto|urna|campanha|candidato|pesquisa)' THEN 'Eleições'
        WHEN txt ~ '(obra|transporte|metrô|ônibus|estrada|infraestrutura|moradia)' THEN 'Infraestrutura'
        WHEN txt ~ '(ambiente|clima|amazônia|desmatamento|enchente|queimada)' THEN 'Meio ambiente'
        WHEN txt ~ '(bolsa família|auxílio|benefício|aposentadoria|inss|social)' THEN 'Programas sociais'
        WHEN txt ~ '(stf|justiça|supremo|tribunal|processo|lei|constituição)' THEN 'Justiça'
        ELSE 'Outros'
      END AS theme
    FROM nv_previous_rows
    WHERE length(txt) > 0
  ), cur AS (
    SELECT theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS neu
    FROM cur_topics
    GROUP BY theme
  ), prev AS (
    SELECT theme, count(*)::bigint AS prev_mentions
    FROM prev_topics
    GROUP BY theme
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'theme', c.theme, 'mentions', c.mentions, 'pos', c.pos, 'neg', c.neg, 'neu', c.neu,
    'prev_mentions', coalesce(p.prev_mentions,0)
  ) ORDER BY c.mentions DESC),'[]'::jsonb)
  INTO v_topics
  FROM cur c LEFT JOIN prev p USING (theme)
  WHERE c.mentions > 0;

  WITH cur_matches AS (
    SELECT lower((m)[1]) AS tag, sent
    FROM nv_current_rows
    CROSS JOIN LATERAL regexp_matches(full_text, '#([[:alnum:]_]+)', 'g') AS m
  ), prev_matches AS (
    SELECT lower((m)[1]) AS tag
    FROM nv_previous_rows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_]+)', 'g') AS m
  ), cur AS (
    SELECT tag,
      count(*)::bigint AS c,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS neu
    FROM cur_matches
    WHERE public.nv_is_valid_hashtag(tag)
    GROUP BY tag
  ), prev AS (
    SELECT tag, count(*)::bigint AS prev_c
    FROM prev_matches
    WHERE public.nv_is_valid_hashtag(tag)
    GROUP BY tag
  ), ranked AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0) AS prev_c
    FROM cur c LEFT JOIN prev p USING (tag)
    ORDER BY c.c DESC
    LIMIT 20
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'tag', '#'||tag,
    'c', c, 'pos', pos, 'neg', neg, 'neu', neu, 'prev_c', prev_c
  ) ORDER BY c DESC),'[]'::jsonb)
  INTO v_hashtags FROM ranked;

  WITH base AS (
    SELECT
      id,
      network AS social_network,
      display_text AS comment_text,
      display_author AS comment_author,
      sent,
      likes,
      replies,
      shares,
      views,
      (likes::numeric + 2 * replies::numeric + 3 * shares::numeric + 0.1 * views::numeric) AS score,
      (likes + replies + shares)::bigint AS eng,
      post_key,
      ts,
      collected_at,
      post_url,
      thumbnail_url
    FROM nv_current_rows
    WHERE COALESCE(NULLIF(display_text,''), NULL) IS NOT NULL
      AND public.nv_is_portuguese_text(full_text)
      AND (likes + replies + shares + views) > 0
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
    'totalInDatabase', v_after_invalid,
    'rawTotalInDatabase', v_total_raw,
    'afterInvalidationFilter', v_after_invalid,
    'afterPeriodFilter', v_after_period,
    'afterCandidateFilter', v_after_candidate,
    'afterPlatformFilter', v_after_platform,
    'afterDeduplication', v_after_platform,
    'deduplicatedPosts', v_after_dedup,
    'finalAnalyticsCount', v_total,
    'loss', GREATEST(v_after_invalid - v_total, 0),
    'lossPct', CASE WHEN v_after_invalid > 0 THEN round(((GREATEST(v_after_invalid - v_total, 0))::numeric / v_after_invalid::numeric) * 100, 2) ELSE 0 END,
    'periodMode', CASE WHEN v_is_total_period THEN 'total' ELSE v_days::text || ' dias' END,
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
      'source', 'social_interactions_raw_single_scan',
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