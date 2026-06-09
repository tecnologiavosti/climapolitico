CREATE TABLE IF NOT EXISTS public.social_metrics_daily (
  date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  positive bigint NOT NULL DEFAULT 0,
  negative bigint NOT NULL DEFAULT 0,
  neutral bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  comments bigint NOT NULL DEFAULT 0,
  shares bigint NOT NULL DEFAULT 0,
  unique_authors bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, user_id, candidate_id, network)
);
GRANT SELECT ON public.social_metrics_daily TO authenticated;
GRANT ALL ON public.social_metrics_daily TO service_role;
ALTER TABLE public.social_metrics_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own social metrics daily" ON public.social_metrics_daily;
CREATE POLICY "Users can read own social metrics daily"
ON public.social_metrics_daily
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_smd_user_date ON public.social_metrics_daily (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_smd_user_candidate_date ON public.social_metrics_daily (user_id, candidate_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_smd_user_network_date ON public.social_metrics_daily (user_id, network, date DESC);
CREATE INDEX IF NOT EXISTS idx_smd_user_candidate_network_date ON public.social_metrics_daily (user_id, candidate_id, network, date DESC);
CREATE INDEX IF NOT EXISTS idx_smd_sentiment_date ON public.social_metrics_daily (user_id, positive, negative, neutral, date DESC);

CREATE OR REPLACE FUNCTION public.refresh_social_metrics_daily(p_since date DEFAULT (current_date - 90), p_until date DEFAULT (current_date + 1))
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE
  v_rows integer := 0;
BEGIN
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RAISE EXCEPTION 'Intervalo inválido.';
  END IF;

  DELETE FROM public.social_metrics_daily
  WHERE date >= p_since AND date < p_until;

  INSERT INTO public.social_metrics_daily (
    date, user_id, candidate_id, network, mentions, positive, negative, neutral,
    likes, comments, shares, unique_authors, updated_at
  )
  SELECT
    COALESCE(si.original_posted_at, si.created_at, si.collected_at)::date AS date,
    si.user_id,
    si.candidate_id,
    public.nv_network_key(si.social_network) AS network,
    count(*)::bigint AS mentions,
    count(*) FILTER (WHERE COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') = 'positive')::bigint AS positive,
    count(*) FILTER (WHERE COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') = 'negative')::bigint AS negative,
    count(*) FILTER (WHERE COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') = 'neutral')::bigint AS neutral,
    sum(COALESCE(si.likes_count,0))::bigint AS likes,
    sum(COALESCE(si.replies_count,0))::bigint AS comments,
    sum(COALESCE(si.shares_count,0))::bigint AS shares,
    count(DISTINCT COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), si.id::text))::bigint AS unique_authors,
    now()
  FROM public.social_interactions si
  WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= p_since::timestamptz
    AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < p_until::timestamptz
    AND si.invalidated_at IS NULL
    AND COALESCE(si.is_political_content, true) = true
    AND si.user_id IS NOT NULL
    AND si.candidate_id IS NOT NULL
    AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  GROUP BY 1,2,3,4
  ON CONFLICT (date, user_id, candidate_id, network) DO UPDATE SET
    mentions = EXCLUDED.mentions,
    positive = EXCLUDED.positive,
    negative = EXCLUDED.negative,
    neutral = EXCLUDED.neutral,
    likes = EXCLUDED.likes,
    comments = EXCLUDED.comments,
    shares = EXCLUDED.shares,
    unique_authors = EXCLUDED.unique_authors,
    updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'rows', v_rows, 'since', p_since, 'until', p_until);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_social_metrics_daily(date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_social_metrics_daily(date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.network_view_core_metrics(
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
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
  v_total bigint := 0;
  v_network_sum bigint := 0;
  v_labeled bigint := 0;
  v_validation jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_core_smd_v1', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,true,0,0,coalesce(jsonb_array_length(v_cached->'by_network'),0),'success',NULL,'{"source":"social_metrics_daily_cache"}'::jsonb);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_metrics_daily'));
  END IF;

  WITH metrics AS MATERIALIZED (
    SELECT *, (date >= v_since) AS is_current
    FROM public.social_metrics_daily
    WHERE date >= v_prev_since
      AND date <= current_date
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
    FROM metrics
  ), series AS (
    SELECT to_char(date,'YYYY-MM-DD') AS day,
      sum(positive)::bigint AS p,
      sum(negative)::bigint AS n,
      sum(neutral)::bigint AS u
    FROM metrics WHERE is_current GROUP BY 1
  ), by_net AS (
    SELECT network,
      sum(mentions)::bigint AS mentions,
      sum(likes)::bigint AS likes,
      sum(comments)::bigint AS replies,
      sum(shares)::bigint AS shares,
      sum(likes + comments + shares)::bigint AS engagement
    FROM metrics WHERE is_current GROUP BY 1
  ), heat AS (
    SELECT dow::int AS dow, hr::int AS hr, sum(mentions)::bigint AS c
    FROM public.daily_heatmap_metrics
    WHERE metric_date >= v_since
      AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1,2
  )
  SELECT jsonb_build_object(
    'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
    'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
  ),
  (SELECT count(*) FROM metrics WHERE is_current),
  (SELECT count(*) FROM by_net)
  INTO v_data, v_records_read, v_records_returned;

  v_total := coalesce((v_data #>> '{kpis,total}')::bigint,0);
  v_labeled := coalesce((v_data #>> '{kpis,pos}')::bigint,0) + coalesce((v_data #>> '{kpis,neg}')::bigint,0) + coalesce((v_data #>> '{kpis,neu}')::bigint,0);
  SELECT coalesce(sum((item->>'mentions')::bigint),0) INTO v_network_sum FROM jsonb_array_elements(coalesce(v_data->'by_network','[]'::jsonb)) AS item;
  v_validation := jsonb_build_object('total_mentions',v_total,'network_sum',v_network_sum,'sentiment_sum',v_labeled,'network_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_network_sum - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END,'sentiment_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_labeled - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END);

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  IF v_total > 0 AND (abs(v_network_sum - v_total)::numeric / v_total::numeric > 0.01 OR abs(v_labeled - v_total)::numeric / v_total::numeric > 0.01) THEN
    PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'validation_error','Divergência superior a 1% nas agregações',jsonb_build_object('source','social_metrics_daily','validation',v_validation));
    RETURN jsonb_build_object('ok',false,'message','Dados em reprocessamento. Atualizando métricas. Recalculando agregações.','diagnostics',jsonb_build_object('source','social_metrics_daily','validation',v_validation));
  END IF;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,v_records_read,v_duration,jsonb_build_object('source','social_metrics_daily','validation',v_validation),now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END,NULL,jsonb_build_object('source','social_metrics_daily','validation',v_validation,'query','network_view_core_metrics'));
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_metrics_daily','records_read',v_records_read,'validation',v_validation));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar as métricas gerais.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid,text,integer) TO authenticated;

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
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_content_agg_v1', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','daily_topic_hashtag_metrics'));
  END IF;

  WITH t_cur AS (
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
  ), t_prev AS (
    SELECT theme, sum(mentions)::bigint AS prev_mentions
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), topics AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM t_cur c LEFT JOIN t_prev p USING (theme)
    ORDER BY c.mentions DESC
    LIMIT 20
  ), h_cur AS (
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
  ), h_prev AS (
    SELECT public.nv_hashtag_display(tag) AS tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      AND public.nv_is_valid_hashtag(replace(tag,'#',''))
    GROUP BY 1
  ), hashtags AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM h_cur c LEFT JOIN h_prev p USING (tag)
    WHERE c.tag IS NOT NULL
    ORDER BY c.c DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags)
  INTO v_data, v_records_read, v_records_returned;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records_read,v_duration,'{"source":"daily_topic_hashtag_metrics","limit":20}'::jsonb,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END,NULL,'{"source":"daily_topic_hashtag_metrics","query":"network_view_content_metrics"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_topic_hashtag_metrics','records_read',v_records_read));
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

  v_cache_key := md5(concat_ws('|','nv_top_endpoint_v1', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions_top_posts'));
  END IF;

  WITH recent AS MATERIALIZED (
    SELECT si.id, public.nv_network_key(si.social_network) AS social_network,
      COALESCE(NULLIF(si.comment_text,''), NULLIF(si.post_title,''), NULLIF(si.post_description,'')) AS comment_text,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), 'anônimo') AS comment_author,
      public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS sent,
      (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at,
      si.collected_at,
      si.post_url,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key,
      greatest(COALESCE(si.political_relevance_score,0), public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name)) AS political_relevance
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE si.original_posted_at >= v_since
      AND si.original_posted_at < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND length(public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description))) >= 12
    ORDER BY si.original_posted_at DESC
    LIMIT 3000
  ), political AS (
    SELECT * FROM recent
    WHERE political_relevance >= 0.45
      AND public.nv_clean_text(comment_text) !~ '(futebol|neymar|cristiano ronaldo|al nassr|palmeiras|corinthians|flamengo|vasco|gremio|grêmio|botafogo|libertadores|campeonato|celebridade|humor|meme|entretenimento|novela|bbb|games|gameplay|musica|música|show|cantor|atriz|ator|esporte|esportes|gospel|funk|sertanej|kpop)'
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM political
    ORDER BY dedup_key, eng DESC, political_relevance DESC, original_posted_at DESC
  ), ranked AS (
    SELECT *, (ln(greatest(eng,0) + 1) * political_relevance) AS score
    FROM deduped
    ORDER BY (ln(greatest(eng,0) + 1) * political_relevance) DESC, eng DESC, original_posted_at DESC
    LIMIT 20
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, eng DESC, original_posted_at DESC),'[]'::jsonb)),
    (SELECT count(*) FROM recent),
    (SELECT count(*) FROM ranked)
  INTO v_data, v_records_read, v_records_returned
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,v_records_read,v_duration,'{"source":"social_interactions_limited_top_posts","limit":20,"sample":3000}'::jsonb,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END,NULL,'{"source":"social_interactions_limited_top_posts","query":"network_view_top_posts"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions_limited_top_posts','records_read',v_records_read));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

DELETE FROM public.network_view_cache WHERE section IN ('core','content','top_posts');