CREATE INDEX IF NOT EXISTS idx_si_nv_user_effective_v13
ON public.social_interactions (user_id, COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_effective_v13
ON public.social_interactions (user_id, candidate_id, COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_network_effective_v13
ON public.social_interactions (user_id, public.nv_network_key(social_network), COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_network_effective_v13
ON public.social_interactions (user_id, candidate_id, public.nv_network_key(social_network), COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_candidate_effective_v13
ON public.social_interactions (candidate_id, COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_network_effective_v13
ON public.social_interactions (public.nv_network_key(social_network), COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_si_nv_sentiment_effective_v13
ON public.social_interactions (sentiment_label, COALESCE(original_posted_at, collected_at, created_at) DESC)
WHERE invalidated_at IS NULL;

CREATE OR REPLACE FUNCTION public.network_view_summary(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.', 'data', jsonb_build_object('kpis', jsonb_build_object()));
  END IF;

  v_cache_key := 'network_view:summary:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;

  SELECT result INTO v_cached
  FROM public.network_view_cache
  WHERE cache_key = v_cache_key AND section = 'summary' AND expires_at > now();

  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), NULLIF(si.author_profile_url,''), si.id::text) AS author_key,
      GREATEST(COALESCE(si.likes_count,0),0)::bigint AS likes,
      GREATEST(COALESCE(si.replies_count,0),0)::bigint AS replies,
      GREATEST(COALESCE(si.shares_count,0),0)::bigint AS shares
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  ), previous_rows AS (
    SELECT 1
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
  ), scoped AS (
    SELECT
      si.invalidated_at,
      si.candidate_id,
      public.nv_network_key(si.social_network) AS network_key,
      COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = v_uid)
  ), debug_counts AS (
    SELECT
      count(*)::bigint AS raw_total,
      count(*) FILTER (WHERE invalidated_at IS NULL)::bigint AS after_invalid,
      count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now())::bigint AS after_period,
      count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now() AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id))::bigint AS after_candidate,
      count(*) FILTER (WHERE invalidated_at IS NULL AND ts IS NOT NULL AND (v_is_total_period OR ts >= v_since) AND ts <= now() AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id) AND (v_network IS NULL OR network_key = v_network))::bigint AS after_platform
    FROM scoped
  ), kpis AS (
    SELECT
      count(*)::bigint AS total,
      count(DISTINCT author_key)::bigint AS authors,
      coalesce(sum(likes + replies + shares),0)::bigint AS engagement,
      coalesce(sum(likes),0)::bigint AS likes,
      coalesce(sum(replies),0)::bigint AS replies,
      coalesce(sum(shares),0)::bigint AS shares,
      (SELECT count(*) FROM previous_rows)::bigint AS prev_total
    FROM current_rows
  )
  SELECT jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'kpis', jsonb_build_object(
        'total', k.total, 'authors', k.authors, 'engagement', k.engagement,
        'likes', k.likes, 'replies', k.replies, 'shares', k.shares,
        'prev_total', k.prev_total
      ),
      'debug', jsonb_build_object(
        'rawTotalInDatabase', d.raw_total,
        'totalInDatabase', d.after_invalid,
        'afterInvalidationFilter', d.after_invalid,
        'afterPeriodFilter', d.after_period,
        'afterCandidateFilter', d.after_candidate,
        'afterPlatformFilter', d.after_platform,
        'afterDeduplication', d.after_platform,
        'finalAnalyticsCount', k.total,
        'loss', GREATEST(d.after_period - k.total, 0),
        'lossPct', CASE WHEN d.after_period > 0 THEN round((GREATEST(d.after_period - k.total, 0)::numeric / d.after_period::numeric) * 100, 2) ELSE 0 END,
        'periodMode', CASE WHEN v_is_total_period THEN 'total' ELSE v_days::text || ' dias' END,
        'mentions', k.total,
        'posts', k.total,
        'classified', k.total
      )
    ),
    'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'summary')
  ), k.total
  INTO v_response, v_source_rows
  FROM kpis k CROSS JOIN debug_counts d;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'summary', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();

  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar resumo.', 'data', jsonb_build_object('kpis', jsonb_build_object()), 'diagnostics', jsonb_build_object('section', 'summary', 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_view_sentiment_block(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.');
  END IF;

  v_cache_key := 'network_view:sentiment:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'sentiment' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT
      COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  ), previous_rows AS (
    SELECT COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
  ), counts AS (
    SELECT
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS neu
    FROM current_rows
  ), prev_counts AS (
    SELECT
      count(*) FILTER (WHERE sent = 'positive')::bigint AS prev_pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS prev_neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS prev_neu
    FROM previous_rows
  ), series AS (
    SELECT to_char(date_trunc('day', ts)::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS u
    FROM current_rows
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'kpis', jsonb_build_object('pos', c.pos, 'neg', c.neg, 'neu', c.neu, 'prev_pos', p.prev_pos, 'prev_neg', p.prev_neg, 'prev_neu', p.prev_neu),
      'series', (SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series)
    ),
    'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'sentiment')
  ), (c.pos + c.neg + c.neu)
  INTO v_response, v_source_rows
  FROM counts c CROSS JOIN prev_counts p;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'sentiment', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();

  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar sentimento.', 'data', jsonb_build_object('kpis', jsonb_build_object(), 'series', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'sentiment', 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_view_engagement_block(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  v_cache_key := 'network_view:engagement:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'engagement' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH by_net AS (
    SELECT public.nv_network_key(si.social_network) AS network,
      count(*)::bigint AS mentions,
      coalesce(sum(GREATEST(COALESCE(si.likes_count,0),0)),0)::bigint AS likes,
      coalesce(sum(GREATEST(COALESCE(si.replies_count,0),0)),0)::bigint AS replies,
      coalesce(sum(GREATEST(COALESCE(si.shares_count,0),0)),0)::bigint AS shares,
      coalesce(sum(GREATEST(COALESCE(si.likes_count,0),0) + GREATEST(COALESCE(si.replies_count,0),0) + GREATEST(COALESCE(si.shares_count,0),0)),0)::bigint AS engagement,
      (count(*)::numeric * 0.4 + coalesce(sum(GREATEST(COALESCE(si.likes_count,0),0) + GREATEST(COALESCE(si.replies_count,0),0) + GREATEST(COALESCE(si.shares_count,0),0)),0)::numeric * 0.6) AS dominance
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
    GROUP BY 1
  )
  SELECT jsonb_build_object('ok', true, 'data', jsonb_build_object('by_network', coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY dominance DESC), '[]'::jsonb)), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'engagement')),
         coalesce(sum(mentions),0)::bigint
  INTO v_response, v_source_rows
  FROM by_net;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'engagement', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar engajamento por rede.', 'data', jsonb_build_object('by_network', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'engagement', 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_view_heatmap_block(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  v_cache_key := 'network_view:heatmap:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'heatmap' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH heat AS (
    SELECT extract(dow FROM COALESCE(si.original_posted_at, si.collected_at, si.created_at))::int AS dow,
      extract(hour FROM COALESCE(si.original_posted_at, si.collected_at, si.created_at))::int AS hr,
      count(*)::bigint AS c
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object('ok', true, 'data', jsonb_build_object('heatmap', coalesce(jsonb_agg(jsonb_build_object('dow', dow, 'hr', hr, 'c', c) ORDER BY dow, hr), '[]'::jsonb)), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'heatmap')),
         coalesce(sum(c),0)::bigint
  INTO v_response, v_source_rows
  FROM heat;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'heatmap', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar heatmap.', 'data', jsonb_build_object('heatmap', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'heatmap', 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_view_topics_block(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  v_cache_key := 'network_view:topics:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'topics' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT lower(concat_ws(' ', si.post_title, si.post_description, si.comment_text)) AS txt,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  ), previous_rows AS (
    SELECT lower(concat_ws(' ', si.post_title, si.post_description, si.comment_text)) AS txt
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
  ), cur_topics AS (
    SELECT CASE
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
      ELSE 'Outros' END AS theme, sent
    FROM current_rows WHERE length(txt) > 0
  ), prev_topics AS (
    SELECT CASE
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
      ELSE 'Outros' END AS theme
    FROM previous_rows WHERE length(txt) > 0
  ), cur AS (
    SELECT theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent NOT IN ('positive','negative'))::bigint AS neu
    FROM cur_topics GROUP BY theme
  ), prev AS (
    SELECT theme, count(*)::bigint AS prev_mentions FROM prev_topics GROUP BY theme
  ), ranked AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM cur c LEFT JOIN prev p USING (theme)
    WHERE c.mentions > 0
    ORDER BY c.mentions DESC
  )
  SELECT jsonb_build_object('ok', true, 'data', jsonb_build_object('topics', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY mentions DESC), '[]'::jsonb)), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'topics')),
         coalesce(sum(mentions),0)::bigint
  INTO v_response, v_source_rows
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'topics', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar assuntos.', 'data', jsonb_build_object('topics', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'topics', 'error', SQLERRM));
END;
$function$;

CREATE OR REPLACE FUNCTION public.network_view_hashtags_block(
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
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  v_cache_key := 'network_view:hashtags:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'hashtags' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT concat_ws(' ', si.post_title, si.post_description, si.comment_text) AS txt,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
      AND concat_ws(' ', si.post_title, si.post_description, si.comment_text) LIKE '%#%'
  ), previous_rows AS (
    SELECT concat_ws(' ', si.post_title, si.post_description, si.comment_text) AS txt
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
      AND concat_ws(' ', si.post_title, si.post_description, si.comment_text) LIKE '%#%'
  ), cur_matches AS (
    SELECT lower((m)[1]) AS tag, sent
    FROM current_rows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇáàâãéèêíìîóòôõúùûçÑñ]+)', 'g') AS m
  ), prev_matches AS (
    SELECT lower((m)[1]) AS tag
    FROM previous_rows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇáàâãéèêíìîóòôõúùûçÑñ]+)', 'g') AS m
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
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM cur c LEFT JOIN prev p USING (tag)
    ORDER BY c.c DESC
    LIMIT 20
  )
  SELECT jsonb_build_object('ok', true, 'data', jsonb_build_object('hashtags', coalesce(jsonb_agg(jsonb_build_object('tag', '#' || tag, 'c', c, 'pos', pos, 'neg', neg, 'neu', neu, 'prev_c', prev_c) ORDER BY c DESC), '[]'::jsonb)), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'hashtags')),
         coalesce(sum(c),0)::bigint
  INTO v_response, v_source_rows
  FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  v_response := jsonb_set(v_response, '{diagnostics,records_read}', to_jsonb(v_source_rows), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'hashtags', v_response, v_source_rows, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar hashtags.', 'data', jsonb_build_object('hashtags', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'hashtags', 'error', SQLERRM));
END;
$function$;

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
  v_summary jsonb;
  v_sentiment jsonb;
  v_engagement jsonb;
  v_heatmap jsonb;
  v_topics jsonb;
  v_hashtags jsonb;
  v_kpis jsonb;
BEGIN
  v_summary := public.network_view_summary(p_candidate_id, p_network, p_days);
  v_sentiment := public.network_view_sentiment_block(p_candidate_id, p_network, p_days);
  v_engagement := public.network_view_engagement_block(p_candidate_id, p_network, p_days);
  v_heatmap := public.network_view_heatmap_block(p_candidate_id, p_network, p_days);
  v_topics := public.network_view_topics_block(p_candidate_id, p_network, p_days);
  v_hashtags := public.network_view_hashtags_block(p_candidate_id, p_network, p_days);
  v_kpis := coalesce(v_summary #> '{data,kpis}', '{}'::jsonb) || coalesce(v_sentiment #> '{data,kpis}', '{}'::jsonb);

  RETURN jsonb_build_object(
    'ok', coalesce((v_summary->>'ok')::boolean, false),
    'data', jsonb_build_object(
      'kpis', v_kpis,
      'series', coalesce(v_sentiment #> '{data,series}', '[]'::jsonb),
      'by_network', coalesce(v_engagement #> '{data,by_network}', '[]'::jsonb),
      'heatmap', coalesce(v_heatmap #> '{data,heatmap}', '[]'::jsonb),
      'topics', coalesce(v_topics #> '{data,topics}', '[]'::jsonb),
      'hashtags', coalesce(v_hashtags #> '{data,hashtags}', '[]'::jsonb),
      'debug', coalesce(v_summary #> '{data,debug}', '{}'::jsonb),
      'analytics', jsonb_build_object(
        'mentions', v_kpis,
        'engagement', coalesce(v_engagement #> '{data,by_network}', '[]'::jsonb),
        'sentiment', coalesce(v_sentiment #> '{data,kpis}', '{}'::jsonb),
        'themes', coalesce(v_topics #> '{data,topics}', '[]'::jsonb),
        'hashtags', coalesce(v_hashtags #> '{data,hashtags}', '[]'::jsonb)
      )
    ),
    'diagnostics', jsonb_build_object(
      'source', 'network_view_parallel_blocks_no_top_posts',
      'sections', jsonb_build_object('summary', v_summary->'diagnostics', 'sentiment', v_sentiment->'diagnostics', 'engagement', v_engagement->'diagnostics', 'heatmap', v_heatmap->'diagnostics', 'topics', v_topics->'diagnostics', 'hashtags', v_hashtags->'diagnostics'),
      'ai_prompt_guardrail', 'Use SOMENTE o analytics JSON atual. Não use cache antigo. Não use memória. Não invente métricas.'
    )
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.network_view_top_posts(uuid,text,integer);

REVOKE ALL ON FUNCTION public.network_view_summary(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_sentiment_block(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_engagement_block(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_heatmap_block(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_topics_block(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_hashtags_block(uuid,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.network_view_analytics(uuid,text,integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.network_view_summary(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_sentiment_block(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_engagement_block(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_heatmap_block(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_topics_block(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_hashtags_block(uuid,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.network_view_analytics(uuid,text,integer) TO authenticated, service_role;