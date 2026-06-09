CREATE INDEX IF NOT EXISTS idx_daily_topic_nv_fast
ON public.daily_topic_metrics (user_id, metric_date DESC, candidate_id, network, mentions DESC);

CREATE INDEX IF NOT EXISTS idx_daily_hashtag_nv_fast
ON public.daily_hashtag_metrics (user_id, metric_date DESC, candidate_id, network, mentions DESC);

CREATE INDEX IF NOT EXISTS idx_si_top_posts_recent_fast
ON public.social_interactions (user_id, original_posted_at DESC, candidate_id, social_network)
WHERE original_posted_at IS NOT NULL AND invalidated_at IS NULL AND comment_text IS NOT NULL;

CREATE OR REPLACE FUNCTION public.network_view_content_metrics(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since date := current_date - (greatest(1, least(coalesce(p_days,30), 3650)) - 1);
  v_prev_since date := current_date - ((greatest(1, least(coalesce(p_days,30), 3650)) * 2) - 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_duration int := 0;
  v_records_returned bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_content_agg_v2', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','daily_topic_hashtag_metrics'));
  END IF;

  WITH t_cur AS MATERIALIZED (
    SELECT theme, sum(mentions)::bigint AS mentions,
      sum(positive_count)::bigint AS pos,
      sum(negative_count)::bigint AS neg,
      sum(neutral_count)::bigint AS neu
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND theme !~* '(geral|outros|misc|diversos|sem tema|futebol|esporte|celebridad|entreten|novela|bbb|música|musica|meme|gameplay|games|gospel|funk|sertanej|kpop|tiktok|reels|viral|influencer|youtuber)'
    GROUP BY 1
    ORDER BY mentions DESC
    LIMIT 20
  ), topics AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu,
      coalesce((
        SELECT sum(p.mentions)::bigint
        FROM public.daily_topic_metrics p
        WHERE p.theme = c.theme
          AND p.metric_date >= v_prev_since AND p.metric_date < v_since
          AND (v_is_admin OR p.user_id = v_uid)
          AND (p_candidate_id IS NULL OR p.candidate_id = p_candidate_id)
          AND (v_network IS NULL OR public.nv_network_key(p.network) = v_network)
      ),0)::bigint AS prev_mentions
    FROM t_cur c
  ), h_cur AS MATERIALIZED (
    SELECT public.nv_hashtag_display(tag) AS tag, sum(mentions)::bigint AS c,
      sum(positive_count)::bigint AS pos,
      sum(negative_count)::bigint AS neg,
      sum(neutral_count)::bigint AS neu
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND public.nv_is_valid_hashtag(replace(tag,'#',''))
    GROUP BY 1
    ORDER BY c DESC
    LIMIT 20
  ), hashtags AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu,
      coalesce((
        SELECT sum(p.mentions)::bigint
        FROM public.daily_hashtag_metrics p
        WHERE public.nv_hashtag_display(p.tag) = c.tag
          AND p.metric_date >= v_prev_since AND p.metric_date < v_since
          AND (v_is_admin OR p.user_id = v_uid)
          AND (p_candidate_id IS NULL OR p.candidate_id = p_candidate_id)
          AND (v_network IS NULL OR public.nv_network_key(p.network) = v_network)
      ),0)::bigint AS prev_c
    FROM h_cur c
    WHERE c.tag IS NOT NULL
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags)
  INTO v_data, v_records_returned;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records_returned,v_duration,'{"source":"daily_topic_hashtag_metrics","limit":20,"version":"v2"}'::jsonb,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_returned,v_records_returned,CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END,NULL,'{"source":"daily_topic_hashtag_metrics","query":"network_view_content_metrics_v2"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_topic_hashtag_metrics','records_read',v_records_returned));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_content_metrics(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.network_view_top_posts(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := current_date::timestamptz - (greatest(1, least(coalesce(p_days,30), 3650)) - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_duration int := 0;
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_top_endpoint_v2', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions_top_posts'));
  END IF;

  WITH recent AS MATERIALIZED (
    SELECT si.id, public.nv_network_key(si.social_network) AS social_network,
      COALESCE(NULLIF(si.comment_text,''), NULLIF(si.post_title,''), NULLIF(si.post_description,'')) AS comment_text,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), 'anônimo') AS comment_author,
      public.nv_fast_sentiment(si.sentiment_label, si.sentiment_score) AS sent,
      (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at,
      si.collected_at,
      si.post_url,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key,
      COALESCE(si.political_relevance_score,0) AS political_relevance
    FROM public.social_interactions si
    WHERE si.original_posted_at >= v_since
      AND si.original_posted_at < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND si.comment_text IS NOT NULL
    ORDER BY si.original_posted_at DESC
    LIMIT 1000
  ), political AS (
    SELECT * FROM recent
    WHERE political_relevance >= 0.45
      AND public.nv_clean_text(comment_text) !~ '(futebol|neymar|cristiano ronaldo|al nassr|palmeiras|corinthians|flamengo|vasco|gremio|grêmio|botafogo|libertadores|campeonato|celebridade|humor|meme|entretenimento|novela|bbb|games|gameplay|musica|música|show|cantor|atriz|ator|esporte|esportes|gospel|funk|sertanej|kpop)'
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM political
    ORDER BY dedup_key, eng DESC, political_relevance DESC, original_posted_at DESC
  ), ranked AS (
    SELECT *, (ln(greatest(eng,0) + 1) * greatest(political_relevance,0.45)) AS score
    FROM deduped
    ORDER BY (ln(greatest(eng,0) + 1) * greatest(political_relevance,0.45)) DESC, eng DESC, original_posted_at DESC
    LIMIT 20
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, eng DESC, original_posted_at DESC),'[]'::jsonb)),
    (SELECT count(*) FROM recent),
    (SELECT count(*) FROM ranked)
  INTO v_data, v_records_read, v_records_returned
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,v_records_read,v_duration,'{"source":"social_interactions_limited_top_posts","limit":20,"sample":1000,"version":"v2"}'::jsonb,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END,NULL,'{"source":"social_interactions_limited_top_posts","query":"network_view_top_posts_v2"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions_limited_top_posts','records_read',v_records_read));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

DELETE FROM public.network_view_cache WHERE section IN ('content','top_posts');