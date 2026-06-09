CREATE OR REPLACE FUNCTION public.nv_hashtag_display(_tag text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH n AS (SELECT public.nv_normalize_hashtag(_tag) AS tag)
  SELECT CASE tag
    WHEN 'politica' THEN '#política'
    WHEN 'politico' THEN '#político'
    WHEN 'politicos' THEN '#políticos'
    WHEN 'politicas' THEN '#políticas'
    WHEN 'eleicao' THEN '#eleição'
    WHEN 'eleicoes' THEN '#eleições'
    WHEN 'flaviobolsonaro' THEN '#fláviobolsonaro'
    WHEN 'camara' THEN '#câmara'
    WHEN 'camarafederal' THEN '#câmarafederal'
    WHEN 'senadofederal' THEN '#senadofederal'
    WHEN 'segurancapublica' THEN '#segurançapública'
    WHEN 'reformatributaria' THEN '#reformatributária'
    ELSE '#' || tag
  END
  FROM n
  WHERE tag IS NOT NULL;
$$;

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
  v_cache_key := md5(concat_ws('|','nv_top_v8', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
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
        WHEN p.original_posted_at >= now() - interval '24 hours' THEN 1.15
        WHEN p.original_posted_at >= now() - interval '7 days' THEN 1.05
        ELSE greatest(0.85, 1 - (extract(epoch FROM (now() - p.original_posted_at)) / greatest(1, extract(epoch FROM (now() - v_since))) * 0.15))
      END AS recency_factor,
      (0.75 + least(1, greatest(0.25, p.political_relevance)) * 0.25) AS relevance_factor
    FROM political p
  ), ranked AS (
    SELECT *, (eng::numeric * relevance_factor * recency_factor) AS score
    FROM scored
    ORDER BY (eng::numeric * relevance_factor * recency_factor) DESC, eng DESC, original_posted_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, eng DESC, original_posted_at DESC),'[]'::jsonb))
  INTO v_data FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,0,v_duration,'{"source":"published_window_score_engagement_relevance_recency_v8"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END; $$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.data_consistency_diagnostics(
  p_days integer DEFAULT 30,
  p_candidate_id uuid DEFAULT NULL
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
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30), 3650)));
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;
  IF NOT v_is_admin THEN
    RETURN jsonb_build_object('ok',false,'message','Acesso restrito a administradores.');
  END IF;

  WITH base AS MATERIALIZED (
    SELECT si.id, si.user_id, si.candidate_id, public.nv_network_key(si.social_network) AS network,
      coalesce(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      coalesce(si.likes_count,0)::bigint AS likes,
      coalesce(si.replies_count,0)::bigint AS replies,
      coalesce(si.shares_count,0)::bigint AS shares,
      coalesce(si.engagement_score,0)::bigint AS stored_engagement,
      si.comment_text, si.post_title, si.post_description,
      si.post_id, si.external_id, si.invalidated_at, si.invalidation_reason,
      si.is_political_content,
      public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name) AS political_score
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE coalesce(si.original_posted_at, si.created_at, si.collected_at) >= v_since
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), source_rows AS (
    SELECT network AS source,
      count(*)::bigint AS records,
      sum(likes + replies + shares)::bigint AS engagement,
      count(*) FILTER (WHERE sent IS NOT NULL)::bigint AS classified,
      count(*) FILTER (WHERE invalidated_at IS NOT NULL OR is_political_content IS FALSE OR political_score < 0.25)::bigint AS discarded
    FROM base GROUP BY 1
  ), totals AS (
    SELECT count(*)::bigint AS total_records,
      sum(likes + replies + shares)::bigint AS total_engagement,
      count(*) FILTER (WHERE sent='positive')::bigint AS positive,
      count(*) FILTER (WHERE sent='negative')::bigint AS negative,
      count(*) FILTER (WHERE sent='neutral' OR sent IS NULL)::bigint AS neutral,
      count(*) FILTER (WHERE sent IS NOT NULL)::bigint AS classified,
      count(*) FILTER (WHERE invalidated_at IS NOT NULL OR is_political_content IS FALSE OR political_score < 0.25)::bigint AS discarded,
      count(*) - count(DISTINCT coalesce(nullif(post_id,''), nullif(external_id,''), md5(lower(trim(coalesce(comment_text,'')))))) AS duplicated
    FROM base
  ), period_rows AS (
    SELECT to_char(effective_at::date,'YYYY-MM-DD') AS day,
      count(*)::bigint AS records,
      sum(likes + replies + shares)::bigint AS engagement,
      count(*) FILTER (WHERE sent IS NOT NULL)::bigint AS classified
    FROM base GROUP BY 1 ORDER BY 1 DESC
  ), hash_rows AS (
    SELECT public.nv_hashtag_display(m[1]) AS tag, count(*)::bigint AS records
    FROM base b, regexp_matches(coalesce(concat_ws(' ', b.comment_text, b.post_title, b.post_description),''), '#([[:alnum:]_áéíóúâêîôûãõçñ-]{3,40})', 'g') AS m
    WHERE public.nv_is_valid_hashtag(m[1])
    GROUP BY 1 ORDER BY records DESC LIMIT 50
  ), topic_rows AS (
    SELECT theme, sum(mentions)::bigint AS records
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_since::date
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
    GROUP BY 1 ORDER BY records DESC LIMIT 50
  ), daily_totals AS (
    SELECT coalesce(sum(mentions),0)::bigint AS daily_mentions,
      coalesce(sum(engagement),0)::bigint AS daily_engagement
    FROM public.daily_network_metrics
    WHERE metric_date >= v_since::date
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
  ), cache_totals AS (
    SELECT coalesce(sum(total_mentions),0)::bigint AS cache_mentions,
      coalesce(sum(total_engagement),0)::bigint AS cache_engagement
    FROM public.candidate_metrics_cache
    WHERE p_candidate_id IS NULL OR candidate_id = p_candidate_id
  )
  SELECT jsonb_build_object(
    'ok', true,
    'period', jsonb_build_object('days', v_days, 'since', v_since),
    'totals', (SELECT to_jsonb(totals.*) FROM totals),
    'by_source', (SELECT coalesce(jsonb_agg(to_jsonb(source_rows.*) ORDER BY records DESC),'[]'::jsonb) FROM source_rows),
    'by_period', (SELECT coalesce(jsonb_agg(to_jsonb(period_rows.*) ORDER BY day DESC),'[]'::jsonb) FROM period_rows),
    'hashtags', (SELECT coalesce(jsonb_agg(to_jsonb(hash_rows.*) ORDER BY records DESC),'[]'::jsonb) FROM hash_rows),
    'topics', (SELECT coalesce(jsonb_agg(to_jsonb(topic_rows.*) ORDER BY records DESC),'[]'::jsonb) FROM topic_rows),
    'comparison', jsonb_build_object(
      'raw_mentions', (SELECT total_records FROM totals),
      'daily_mentions', (SELECT daily_mentions FROM daily_totals),
      'cache_mentions_all_time', (SELECT cache_mentions FROM cache_totals),
      'raw_engagement', (SELECT total_engagement FROM totals),
      'daily_engagement', (SELECT daily_engagement FROM daily_totals),
      'cache_engagement_all_time', (SELECT cache_engagement FROM cache_totals),
      'daily_vs_raw_mentions_diff_pct', CASE WHEN (SELECT total_records FROM totals) > 0 THEN round(abs((SELECT daily_mentions FROM daily_totals) - (SELECT total_records FROM totals))::numeric / (SELECT total_records FROM totals)::numeric * 100, 2) ELSE 0 END
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.data_consistency_diagnostics(integer,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.data_consistency_diagnostics(integer,uuid) TO authenticated, service_role;

DELETE FROM public.network_view_cache;