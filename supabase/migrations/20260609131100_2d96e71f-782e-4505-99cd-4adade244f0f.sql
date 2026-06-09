CREATE OR REPLACE FUNCTION public.network_view_core_metrics(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_core_v8', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  IF v_days >= 3650 THEN
    WITH cache_rows AS (
      SELECT * FROM public.candidate_metrics_cache
      WHERE (v_is_admin OR user_id = v_uid)
        AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
    ), expanded_network AS (
      SELECT public.nv_network_key(nb->>'network') AS network,
        coalesce((nb->>'mentions')::bigint,0) AS mentions,
        coalesce((nb->>'engagement')::bigint,0) AS engagement
      FROM cache_rows cr CROSS JOIN LATERAL jsonb_array_elements(cr.network_breakdown) nb
      WHERE v_network IS NULL OR public.nv_network_key(nb->>'network') = v_network
    ), filtered_cache AS (
      SELECT cr.*
      FROM cache_rows cr
      WHERE v_network IS NULL OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(cr.network_breakdown) nb WHERE public.nv_network_key(nb->>'network') = v_network
      )
    ), kpis AS (
      SELECT
        CASE WHEN v_network IS NULL THEN coalesce(sum(total_mentions),0)::bigint ELSE coalesce((SELECT sum(mentions) FROM expanded_network),0)::bigint END AS total,
        CASE WHEN v_network IS NULL THEN coalesce(sum(unique_authors),0)::bigint ELSE 0::bigint END AS authors,
        CASE WHEN v_network IS NULL THEN coalesce(sum(total_engagement),0)::bigint ELSE coalesce((SELECT sum(engagement) FROM expanded_network),0)::bigint END AS engagement,
        CASE WHEN v_network IS NULL THEN coalesce(sum(total_likes),0)::bigint ELSE coalesce((SELECT sum(engagement) FROM expanded_network),0)::bigint END AS likes,
        CASE WHEN v_network IS NULL THEN coalesce(sum(total_replies),0)::bigint ELSE 0::bigint END AS replies,
        CASE WHEN v_network IS NULL THEN coalesce(sum(total_shares),0)::bigint ELSE 0::bigint END AS shares,
        CASE WHEN v_network IS NULL THEN coalesce(sum(positive_count),0)::bigint ELSE 0::bigint END AS pos,
        CASE WHEN v_network IS NULL THEN coalesce(sum(negative_count),0)::bigint ELSE 0::bigint END AS neg,
        CASE WHEN v_network IS NULL THEN coalesce(sum(neutral_count),0)::bigint ELSE coalesce((SELECT sum(mentions) FROM expanded_network),0)::bigint END AS neu,
        0::bigint AS prev_total, 0::bigint AS prev_pos, 0::bigint AS prev_neg, 0::bigint AS prev_neu
      FROM filtered_cache
    ), by_net AS (
      SELECT network, sum(mentions)::bigint AS mentions, sum(engagement)::bigint AS likes,
        0::bigint AS replies, 0::bigint AS shares, sum(engagement)::bigint AS engagement
      FROM expanded_network GROUP BY 1
    ), heat AS (
      SELECT dow::int AS dow, hr::int AS hr, sum(mentions)::bigint AS c
      FROM public.daily_heatmap_metrics
      WHERE (v_is_admin OR user_id = v_uid)
        AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
        AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
      GROUP BY 1,2
    )
    SELECT jsonb_build_object(
      'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
      'series','[]'::jsonb,
      'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
      'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
    ) INTO v_data;
  ELSE
    WITH net AS (
      SELECT metric_date, public.nv_network_key(network) AS network, mentions, unique_authors, likes, replies, shares, engagement,
        positive_count, negative_count, neutral_count, unknown_count, (metric_date >= v_since) AS is_current
      FROM public.daily_network_metrics
      WHERE metric_date >= v_prev_since
        AND (v_is_admin OR user_id = v_uid)
        AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
        AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    ), kpis AS (
      SELECT
        coalesce(sum(mentions) FILTER (WHERE is_current),0)::bigint AS total,
        coalesce(sum(unique_authors) FILTER (WHERE is_current),0)::bigint AS authors,
        coalesce(sum(engagement) FILTER (WHERE is_current),0)::bigint AS engagement,
        coalesce(sum(likes) FILTER (WHERE is_current),0)::bigint AS likes,
        coalesce(sum(replies) FILTER (WHERE is_current),0)::bigint AS replies,
        coalesce(sum(shares) FILTER (WHERE is_current),0)::bigint AS shares,
        coalesce(sum(positive_count) FILTER (WHERE is_current),0)::bigint AS pos,
        coalesce(sum(negative_count) FILTER (WHERE is_current),0)::bigint AS neg,
        coalesce(sum(neutral_count + unknown_count) FILTER (WHERE is_current),0)::bigint AS neu,
        coalesce(sum(mentions) FILTER (WHERE NOT is_current),0)::bigint AS prev_total,
        coalesce(sum(positive_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_pos,
        coalesce(sum(negative_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_neg,
        coalesce(sum(neutral_count + unknown_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_neu
      FROM net
    ), series AS (
      SELECT to_char(metric_date,'YYYY-MM-DD') AS day,
        sum(positive_count)::bigint AS p, sum(negative_count)::bigint AS n, sum(neutral_count + unknown_count)::bigint AS u
      FROM net WHERE is_current GROUP BY 1
    ), by_net AS (
      SELECT network, sum(mentions)::bigint AS mentions, sum(likes)::bigint AS likes,
        sum(replies)::bigint AS replies, sum(shares)::bigint AS shares, sum(engagement)::bigint AS engagement
      FROM net WHERE is_current GROUP BY 1
    ), heat AS (
      SELECT dow::int AS dow, hr::int AS hr, sum(mentions)::bigint AS c
      FROM public.daily_heatmap_metrics
      WHERE metric_date >= v_since
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
    ) INTO v_data;
  END IF;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,0,v_duration,jsonb_build_object('source',CASE WHEN v_days >= 3650 THEN 'candidate_metrics_cache' ELSE 'daily_aggregates' END), now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source',CASE WHEN v_days >= 3650 THEN 'candidate_metrics_cache' ELSE 'daily_aggregates' END));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar as métricas gerais.');
END; $$;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.network_view_content_metrics(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_content_v7', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH t_cur AS (
    SELECT theme, sum(mentions)::bigint AS mentions,
      sum(positive_count)::bigint AS pos, sum(negative_count)::bigint AS neg, sum(neutral_count)::bigint AS neu
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
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
    FROM t_cur c LEFT JOIN t_prev p USING (theme) WHERE c.mentions > 0 ORDER BY mentions DESC LIMIT 15
  ), h_cur AS (
    SELECT tag, sum(mentions)::bigint AS c,
      sum(positive_count)::bigint AS pos, sum(negative_count)::bigint AS neg, sum(neutral_count)::bigint AS neu
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), h_prev AS (
    SELECT tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), hashtags AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM h_cur c LEFT JOIN h_prev p USING (tag)
    WHERE public.nv_is_valid_hashtag(replace(c.tag,'#',''))
    ORDER BY c.c DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ) INTO v_data;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,0,v_duration,'{"source":"daily_political_aggregates"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_political_aggregates'));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.');
END; $$;
GRANT EXECUTE ON FUNCTION public.network_view_content_metrics(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.network_view_top_posts(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := now() - make_interval(days => v_days);
  v_until timestamptz := now();
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_top_v7', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH cands AS MATERIALIZED (
    SELECT si.id, public.nv_network_key(si.social_network) AS social_network, si.comment_text, si.comment_author,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes, COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at, si.collected_at, si.post_url,
      public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name) AS political_relevance
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE si.original_posted_at >= v_since
      AND si.original_posted_at < v_until
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0)) DESC NULLS LAST, si.original_posted_at DESC
    LIMIT 5000
  ), political AS (
    SELECT * FROM cands WHERE political_relevance >= 0.25
  ), scored AS (
    SELECT p.*,
      CASE
        WHEN p.original_posted_at >= now() - interval '24 hours' THEN 1.35
        WHEN p.original_posted_at >= now() - interval '7 days' THEN 1.15
        ELSE greatest(0.15, 1 - (extract(epoch FROM (now() - p.original_posted_at)) / greatest(1, extract(epoch FROM (now() - v_since))) * 0.85))
      END AS recency_factor,
      (ln(greatest(p.eng,0) + 1) *
       CASE
        WHEN p.original_posted_at >= now() - interval '24 hours' THEN 1.35
        WHEN p.original_posted_at >= now() - interval '7 days' THEN 1.15
        ELSE greatest(0.15, 1 - (extract(epoch FROM (now() - p.original_posted_at)) / greatest(1, extract(epoch FROM (now() - v_since))) * 0.85))
       END * p.political_relevance) AS score
    FROM political p
  ), ranked AS (
    SELECT * FROM scored ORDER BY score DESC, eng DESC, original_posted_at DESC LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, eng DESC, original_posted_at DESC),'[]'::jsonb))
  INTO v_data FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,0,v_duration,'{"source":"published_window_top5000_score_engagement_recency_politics"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END; $$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

DELETE FROM public.network_view_cache;