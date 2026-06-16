
-- Consumer network filter
CREATE OR REPLACE FUNCTION public.nv_is_consumer_network(_net text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $$
  SELECT lower(coalesce(_net,'')) IN ('youtube','facebook','tiktok','telegram','twitter','x','google_news','news','linkedin','reddit','instagram');
$$;

-- Engagement block: filter consumer networks + sentiment breakdown per network
CREATE OR REPLACE FUNCTION public.network_view_engagement_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  PERFORM set_config('statement_timeout','25000', true);
  v_cache_key := 'network_view:engagement:v3:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
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
      count(*) FILTER (WHERE lower(coalesce(si.sentiment_label,'')) IN ('positivo','positive','pos'))::bigint AS pos,
      count(*) FILTER (WHERE lower(coalesce(si.sentiment_label,'')) IN ('negativo','negative','neg'))::bigint AS neg,
      count(*) FILTER (WHERE lower(coalesce(si.sentiment_label,'')) NOT IN ('positivo','positive','pos','negativo','negative','neg'))::bigint AS neu,
      (count(*)::numeric * 0.4 + coalesce(sum(GREATEST(COALESCE(si.likes_count,0),0) + GREATEST(COALESCE(si.replies_count,0),0) + GREATEST(COALESCE(si.shares_count,0),0)),0)::numeric * 0.6) AS dominance
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
    GROUP BY 1
  )
  SELECT jsonb_build_object('ok', true, 'data', jsonb_build_object('by_network', coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY dominance DESC), '[]'::jsonb)), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'engagement')),
         coalesce(sum(mentions),0)::bigint
  INTO v_response, v_source_rows FROM by_net;

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

-- Terms block: top hashtags + Brazilian political entities, ranked by frequency
CREATE OR REPLACE FUNCTION public.network_view_terms_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  v_entities text[] := ARRAY[
    'Lula','Bolsonaro','Flávio Bolsonaro','Eduardo Bolsonaro','Michelle Bolsonaro','Tarcísio','Pacheco','Lira','Haddad','Janja',
    'Moraes','Aras','Dino','Pacheco','Mendonça','Cármen Lúcia','Toffoli','Barroso','Fachin','Zanin',
    'STF','PT','PL','PSDB','PSD','União','MDB','Republicanos','Novo','Psol','PCdoB','PDT',
    'Trump','Biden','Maduro','Milei','Putin','Zelensky','Macron','Xi Jinping',
    'Eleições 2026','Eleições','Congresso','Senado','Câmara','Planalto','TSE','PGR','PF',
    'Amazônia','SUS','PIB','Inflação','Reforma Tributária','Bolsa Família','Pix'
  ];
  v_ent text;
  v_terms jsonb := '[]'::jsonb;
  v_hashtag_rows jsonb;
  v_entity_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  PERFORM set_config('statement_timeout','25000', true);
  v_cache_key := 'network_view:terms:v1:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'terms' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  -- Top hashtags
  WITH hrows AS (
    SELECT coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'') AS txt
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND (position('#' in coalesce(si.post_title,'')) > 0 OR position('#' in coalesce(si.comment_text,'')) > 0)
  ), matches AS (
    SELECT lower((m)[1]) AS tag FROM hrows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇáàâãéèêíìîóòôõúùûçÑñ]+)', 'g') AS m
  ), agg AS (
    SELECT '#' || tag AS term, count(*)::bigint AS c FROM matches
    WHERE public.nv_is_valid_hashtag(tag)
    GROUP BY tag ORDER BY count(*) DESC LIMIT 15
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('term', term, 'count', c, 'kind', 'hashtag')), '[]'::jsonb) INTO v_hashtag_rows FROM agg;

  -- Top entities: scan once with all keywords
  WITH base AS (
    SELECT lower(coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'')) AS txt
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND (si.post_title IS NOT NULL OR si.comment_text IS NOT NULL)
  ), ent AS (
    SELECT e AS term, (SELECT count(*) FROM base WHERE position(lower(e) in base.txt) > 0)::bigint AS c
    FROM unnest(v_entities) AS e
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('term', term, 'count', c, 'kind', 'entity') ORDER BY c DESC), '[]'::jsonb)
  INTO v_entity_rows FROM ent WHERE c > 0;

  v_terms := (
    SELECT coalesce(jsonb_agg(x ORDER BY (x->>'count')::bigint DESC), '[]'::jsonb)
    FROM (
      SELECT * FROM jsonb_array_elements(v_entity_rows)
      UNION ALL
      SELECT * FROM jsonb_array_elements(v_hashtag_rows)
    ) t(x)
  );
  -- keep top 25
  v_terms := (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_terms) WITH ORDINALITY t(x, n) ORDER BY n LIMIT 25) s);

  v_response := jsonb_build_object('ok', true, 'data', jsonb_build_object('terms', v_terms), 'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'terms'));
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'terms', v_response, 0, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar termos.', 'data', jsonb_build_object('terms', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'terms', 'error', SQLERRM));
END;
$function$;

REVOKE ALL ON FUNCTION public.network_view_terms_block(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_view_terms_block(uuid,text,integer) TO authenticated, service_role;

-- Apply consumer network filter to summary, sentiment, topics blocks (preserve existing logic, only add the AND clause)
CREATE OR REPLACE FUNCTION public.network_view_summary(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.', 'data', jsonb_build_object('kpis', jsonb_build_object())); END IF;
  PERFORM set_config('statement_timeout','25000', true);
  v_cache_key := 'network_view:summary:v3:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'summary' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT GREATEST(COALESCE(si.likes_count,0),0)::bigint AS likes,
      GREATEST(COALESCE(si.replies_count,0),0)::bigint AS replies,
      GREATEST(COALESCE(si.shares_count,0),0)::bigint AS shares,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_name,''), NULLIF(si.author_handle,''), si.id::text) AS author_key
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  )
  SELECT jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'kpis', jsonb_build_object(
        'total', count(*)::bigint,
        'authors', count(DISTINCT author_key)::bigint,
        'engagement', coalesce(sum(likes + replies + shares),0)::bigint,
        'likes', coalesce(sum(likes),0)::bigint,
        'replies', coalesce(sum(replies),0)::bigint,
        'shares', coalesce(sum(shares),0)::bigint
      )
    ),
    'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'summary')
  )
  INTO v_response FROM current_rows;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'summary', v_response, 0, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar resumo.', 'data', jsonb_build_object('kpis', jsonb_build_object()), 'diagnostics', jsonb_build_object('section', 'summary', 'error', SQLERRM));
END;
$function$;

-- Sentiment block: add consumer filter
CREATE OR REPLACE FUNCTION public.network_view_sentiment_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  PERFORM set_config('statement_timeout','25000', true);
  v_cache_key := 'network_view:sentiment:v3:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'sentiment' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive' WHEN 'pos' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative' WHEN 'neg' THEN 'negative'
        ELSE 'neutral' END AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  ), counts AS (
    SELECT count(*) FILTER (WHERE sent='positive')::bigint AS pos,
           count(*) FILTER (WHERE sent='negative')::bigint AS neg,
           count(*) FILTER (WHERE sent='neutral')::bigint AS neu FROM current_rows
  ), series AS (
    SELECT to_char(date_trunc('day', ts)::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent='positive')::bigint AS p,
      count(*) FILTER (WHERE sent='negative')::bigint AS n,
      count(*) FILTER (WHERE sent='neutral')::bigint AS u
    FROM current_rows GROUP BY 1
  )
  SELECT jsonb_build_object('ok', true,
    'data', jsonb_build_object(
      'kpis', jsonb_build_object('pos', c.pos, 'neg', c.neg, 'neu', c.neu),
      'series', (SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series)
    ),
    'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'sentiment')
  ) INTO v_response FROM counts c;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'sentiment', v_response, 0, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar sentimento.', 'data', jsonb_build_object('kpis', jsonb_build_object(), 'series', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'sentiment', 'error', SQLERRM));
END;
$function$;

-- Topics block: add consumer filter (uses nv_classify_theme already created)
CREATE OR REPLACE FUNCTION public.network_view_topics_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  PERFORM set_config('statement_timeout','25000', true);
  v_cache_key := 'network_view:topics:v4:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'topics' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT public.nv_classify_theme(lower(coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,''))) AS theme,
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative'
        ELSE 'neutral' END AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_is_consumer_network(public.nv_network_key(si.social_network))
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND (si.post_title IS NOT NULL OR si.comment_text IS NOT NULL)
  ), cur AS (
    SELECT theme, count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent='positive')::bigint AS pos,
      count(*) FILTER (WHERE sent='negative')::bigint AS neg,
      count(*) FILTER (WHERE sent='neutral')::bigint AS neu
    FROM current_rows WHERE theme IS NOT NULL GROUP BY theme
  )
  SELECT jsonb_build_object('ok', true,
    'data', jsonb_build_object('topics', coalesce(jsonb_agg(jsonb_build_object('theme', theme, 'mentions', mentions, 'pos', pos, 'neg', neg, 'neu', neu) ORDER BY mentions DESC), '[]'::jsonb)),
    'diagnostics', jsonb_build_object('cache_hit', false, 'section', 'topics'))
  INTO v_response FROM cur;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;
  v_response := jsonb_set(v_response, '{diagnostics,duration_ms}', to_jsonb(v_duration), true);
  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, expires_at, created_at, last_hit_at, updated_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, coalesce(v_network,'all'), v_days, 'topics', v_response, 0, v_duration, now() + interval '5 minutes', now(), now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, duration_ms = EXCLUDED.duration_ms, expires_at = EXCLUDED.expires_at, updated_at = now();
  RETURN v_response;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar assuntos.', 'data', jsonb_build_object('topics', '[]'::jsonb), 'diagnostics', jsonb_build_object('section', 'topics', 'error', SQLERRM));
END;
$function$;

DELETE FROM public.network_view_cache;
