CREATE INDEX IF NOT EXISTS idx_si_nv_user_effective_at_v12
ON public.social_interactions (user_id, (COALESCE(original_posted_at, created_at, collected_at)) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_effective_at_v12
ON public.social_interactions (user_id, candidate_id, (COALESCE(original_posted_at, created_at, collected_at)) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_network_effective_at_v12
ON public.social_interactions (user_id, (public.nv_network_key(social_network)), (COALESCE(original_posted_at, created_at, collected_at)) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_sentiment_effective_at_v12
ON public.social_interactions (user_id, sentiment_label, (COALESCE(original_posted_at, created_at, collected_at)) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_post_dedup_v12
ON public.social_interactions (user_id, (COALESCE(NULLIF(post_url,''), NULLIF(external_id,''), NULLIF(post_id,''), id::text)))
WHERE invalidated_at IS NULL;

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
  v_since timestamptz := current_date::timestamptz - (greatest(1, least(coalesce(p_days,30), 3650)) - 1) * interval '1 day';
  v_prev_since timestamptz := current_date::timestamptz - ((greatest(1, least(coalesce(p_days,30), 3650)) * 2) - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
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

  v_cache_key := md5(concat_ws('|','nv_core_raw_v12', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,true,0,0,coalesce(jsonb_array_length(v_cached->'by_network'),0),'success',NULL,'{"source":"social_interactions_cache_v12"}'::jsonb);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions'));
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      si.id,
      si.user_id,
      si.candidate_id,
      public.nv_network_key(si.social_network) AS network,
      COALESCE(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), si.id::text) AS author_key,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), current_base AS MATERIALIZED (
    SELECT * FROM base WHERE effective_at >= v_since
  ), dedup_current AS MATERIALIZED (
    SELECT * FROM (
      SELECT b.*, row_number() OVER (PARTITION BY b.user_id, b.network, b.dedup_key ORDER BY (b.likes + b.replies + b.shares) DESC, b.effective_at DESC, b.id) AS rn
      FROM current_base b
    ) ranked WHERE rn = 1
  ), kpis AS (
    SELECT
      count(*)::bigint AS total,
      count(DISTINCT author_key)::bigint AS authors,
      coalesce((SELECT sum(likes + replies + shares) FROM dedup_current),0)::bigint AS engagement,
      coalesce((SELECT sum(likes) FROM dedup_current),0)::bigint AS likes,
      coalesce((SELECT sum(replies) FROM dedup_current),0)::bigint AS replies,
      coalesce((SELECT sum(shares) FROM dedup_current),0)::bigint AS shares,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since) AS prev_total,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'positive') AS prev_pos,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'negative') AS prev_neg,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'neutral') AS prev_neu
    FROM current_base
  ), series AS (
    SELECT to_char(effective_at::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS u
    FROM current_base
    GROUP BY 1
  ), net_mentions AS (
    SELECT network, count(*)::bigint AS mentions
    FROM current_base
    GROUP BY 1
  ), net_engagement AS (
    SELECT network,
      sum(likes)::bigint AS likes,
      sum(replies)::bigint AS replies,
      sum(shares)::bigint AS shares,
      sum(likes + replies + shares)::bigint AS engagement
    FROM dedup_current
    GROUP BY 1
  ), by_net AS (
    SELECT m.network, m.mentions,
      coalesce(e.likes,0)::bigint AS likes,
      coalesce(e.replies,0)::bigint AS replies,
      coalesce(e.shares,0)::bigint AS shares,
      coalesce(e.engagement,0)::bigint AS engagement
    FROM net_mentions m
    LEFT JOIN net_engagement e USING (network)
  ), heat AS (
    SELECT extract(dow FROM effective_at)::int AS dow,
      extract(hour FROM effective_at)::int AS hr,
      count(*)::bigint AS c
    FROM current_base
    GROUP BY 1,2
  )
  SELECT jsonb_build_object(
    'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
    'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
  ),
  (SELECT count(*) FROM current_base),
  (SELECT count(*) FROM by_net)
  INTO v_data, v_records_read, v_records_returned;

  v_total := coalesce((v_data #>> '{kpis,total}')::bigint,0);
  v_labeled := coalesce((v_data #>> '{kpis,pos}')::bigint,0) + coalesce((v_data #>> '{kpis,neg}')::bigint,0) + coalesce((v_data #>> '{kpis,neu}')::bigint,0);
  SELECT coalesce(sum((item->>'mentions')::bigint),0) INTO v_network_sum FROM jsonb_array_elements(coalesce(v_data->'by_network','[]'::jsonb)) AS item;
  v_validation := jsonb_build_object('total_mentions',v_total,'network_sum',v_network_sum,'sentiment_sum',v_labeled,'network_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_network_sum - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END,'sentiment_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_labeled - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END);

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  IF v_total > 0 AND (abs(v_network_sum - v_total)::numeric / v_total::numeric > 0.01 OR abs(v_labeled - v_total)::numeric / v_total::numeric > 0.01) THEN
    PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'validation_error','Divergência superior a 1% nas agregações',jsonb_build_object('source','social_interactions','validation',v_validation));
    RETURN jsonb_build_object('ok',false,'message','Dados em reprocessamento. Atualizando métricas. Recalculando agregações.','diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions','validation',v_validation));
  END IF;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,v_records_read,v_duration,jsonb_build_object('source','social_interactions','version','raw_v12','validation',v_validation),now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'success',NULL,jsonb_build_object('source','social_interactions','validation',v_validation));
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions','records_read',v_records_read,'validation',v_validation));
EXCEPTION WHEN OTHERS THEN
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,0,'error',SQLERRM,jsonb_build_object('source','social_interactions'));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true,'source','social_interactions'));
  END IF;
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
  v_since timestamptz := current_date::timestamptz - (greatest(1, least(coalesce(p_days,30), 3650)) - 1) * interval '1 day';
  v_prev_since timestamptz := current_date::timestamptz - ((greatest(1, least(coalesce(p_days,30), 3650)) * 2) - 1) * interval '1 day';
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

  v_cache_key := md5(concat_ws('|','nv_content_raw_v12', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,true,0,0,coalesce(jsonb_array_length(v_cached->'topics'),0) + coalesce(jsonb_array_length(v_cached->'hashtags'),0),'success',NULL,'{"source":"social_interactions_cache_v12"}'::jsonb);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions'));
  END IF;

  WITH dict(theme, pattern) AS (VALUES
    ('Eleições','(eleic|eleiç|voto|urna|campanha|candidat|tse|coligac|debate eleitoral|pesquisa eleitoral|datafolha|quaest|ipec|atlas intel)'),
    ('Governo','(governo|planalto|presidente|presidencia|minist|secretaria|gestao publica|gestão pública|executivo)'),
    ('Congresso','(camara|câmara|congresso|deputad|senado|senador|cpi|cpmi|emenda parlamentar|lira|pacheco)'),
    ('STF e Justiça','(stf|supremo|moraes|barroso|gilmar|fachin|toffoli|fux|dino|tse|tcu|justica eleitoral|justiça eleitoral|julgamento|inelegib|cassac|cassação)'),
    ('Economia Pública','(econom|inflac|inflaç|desemprego|emprego|salario|salário|pib|imposto|tribut|juros|selic|dolar|dólar|fiscal|orcament|orçament|bolsa familia|bolsa família|auxilio|auxílio|arcabouco|arcabouço)'),
    ('Segurança Pública','(seguranca publica|segurança publica|violencia|violência|policia|polícia|crime|homicid|trafic|facç|facc|milicia|milícia|pcc|cv)'),
    ('Corrupção','(corrup|propina|desvio|lava jato|peculato|escandal|escândal|delaç|delac)'),
    ('Reformas e Leis','(reforma tribut|reforma administrativa|previdencia|previdência|pec|medida provisoria|medida provisória|lei complementar|regulamentac|regulamentação)'),
    ('8 de Janeiro e Democracia','(anistia|8 de janeiro|janeiro de 2023|golpe|golpist|democracia|ditadura|autoritari)'),
    ('Política Internacional','(brics|onu|otan|mercosul|maduro|trump|biden|putin|milei|venezuela|argentina|china|gaza|israel|ucrania|ucrân)'),
    ('Saúde e Educação','(sus|saude publica|saúde pública|educacao publica|educação pública|escola publica|universidade federal|professor|mec|ministério da saúde|ministério da educação)'),
    ('Partidos e Articulação','(pt|pl|psdb|mdb|psol|psb|pdt|novo|união brasil|uniao brasil|republicanos|pp|podemos|valdemar|kassab|articulac|articulação|aliad|oposição|oposicao)')
  ), base AS MATERIALIZED (
    SELECT
      public.nv_network_key(si.social_network) AS network,
      COALESCE(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
      public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS text_blob,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), tagged AS (
    SELECT (b.effective_at >= v_since) AS is_current,
      public.nv_hashtag_display(public.nv_normalize_hashtag(m[1])) AS tag,
      b.sent
    FROM base b, regexp_matches(coalesce(b.text_blob,''), '#([[:alnum:]_áéíóúâêîôûãõçñ-]{3,80})', 'g') AS m
    WHERE public.nv_is_valid_hashtag(public.nv_normalize_hashtag(m[1]))
  ), h_cur AS (
    SELECT tag, count(*)::bigint AS c,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM tagged
    WHERE is_current AND tag IS NOT NULL
    GROUP BY 1
  ), h_prev AS (
    SELECT tag, count(*)::bigint AS prev_c
    FROM tagged
    WHERE NOT is_current AND tag IS NOT NULL
    GROUP BY 1
  ), hashtags AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM h_cur c
    LEFT JOIN h_prev p USING (tag)
    ORDER BY c.c DESC
    LIMIT 20
  ), topic_hits AS (
    SELECT (b.effective_at >= v_since) AS is_current, d.theme, b.sent
    FROM base b
    JOIN dict d ON b.text_blob ~ d.pattern
  ), t_cur AS (
    SELECT theme, count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM topic_hits
    WHERE is_current
    GROUP BY 1
  ), t_prev AS (
    SELECT theme, count(*)::bigint AS prev_mentions
    FROM topic_hits
    WHERE NOT is_current
    GROUP BY 1
  ), topics AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM t_cur c
    LEFT JOIN t_prev p USING (theme)
    WHERE c.mentions > 0
    ORDER BY c.mentions DESC
    LIMIT 15
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ),
  (SELECT count(*) FROM base WHERE effective_at >= v_since),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags)
  INTO v_data, v_records_read, v_records_returned;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records_read,v_duration,'{"source":"social_interactions_raw_content_v12","note":"topics_allow_multiple_per_mention"}'::jsonb,now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'success',NULL,'{"source":"social_interactions","version":"raw_v12"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions','records_read',v_records_read));
EXCEPTION WHEN OTHERS THEN
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,0,'error',SQLERRM,'{"source":"social_interactions"}'::jsonb);
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true,'source','social_interactions'));
  END IF;
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

  v_cache_key := md5(concat_ws('|','nv_top_raw_v12', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,true,0,0,coalesce(jsonb_array_length(v_cached->'top_posts'),0),'success',NULL,'{"source":"social_interactions_cache_v12"}'::jsonb);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions'));
  END IF;

  WITH cands AS MATERIALIZED (
    SELECT
      si.id,
      public.nv_network_key(si.social_network) AS social_network,
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
      AND length(public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description))) >= 12
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), political AS (
    SELECT * FROM cands
    WHERE political_relevance >= 0.45
      AND public.nv_clean_text(comment_text) !~ '(futebol|neymar|cristiano ronaldo|al nassr|santos fc|palmeiras|corinthians|flamengo|vasco|gremio|grêmio|botafogo|libertadores|campeonato|celebridade|celebridades|humor|meme|memes|entretenimento|novela|bbb|games|gameplay|musica|música|show|cantor|atriz|ator|esporte|esportes|gospel|funk|sertanej|kpop|influencer)'
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM political
    ORDER BY dedup_key, eng DESC, political_relevance DESC, original_posted_at DESC
  ), ranked AS (
    SELECT *, (ln(greatest(eng,0) + 1) * political_relevance) AS score
    FROM deduped
    ORDER BY (ln(greatest(eng,0) + 1) * political_relevance) DESC, eng DESC, original_posted_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, eng DESC, original_posted_at DESC),'[]'::jsonb)),
    (SELECT count(*) FROM cands),
    (SELECT count(*) FROM ranked)
  INTO v_data, v_records_read, v_records_returned
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,v_records_read,v_duration,'{"source":"social_interactions_published_window_political_dedup_v12"}'::jsonb,now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'success',NULL,'{"source":"social_interactions","version":"raw_v12"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions','records_read',v_records_read));
EXCEPTION WHEN OTHERS THEN
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,0,'error',SQLERRM,'{"source":"social_interactions"}'::jsonb);
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true,'source','social_interactions'));
  END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;