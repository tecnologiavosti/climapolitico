
CREATE OR REPLACE FUNCTION public.nv_classify_theme(_txt text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN strpos(_txt,'eleição')>0 OR strpos(_txt,'eleições')>0 OR strpos(_txt,'voto')>0 OR strpos(_txt,'urna')>0 OR strpos(_txt,'campanha')>0 OR strpos(_txt,'candidato')>0 OR strpos(_txt,'pesquisa')>0 THEN 'Eleições'
    WHEN strpos(_txt,'stf')>0 OR strpos(_txt,'supremo')>0 OR strpos(_txt,'justiça')>0 OR strpos(_txt,'moraes')>0 OR strpos(_txt,'tribunal')>0 THEN 'STF e Justiça'
    WHEN strpos(_txt,'corrupção')>0 OR strpos(_txt,'propina')>0 OR strpos(_txt,'rachadinha')>0 OR strpos(_txt,'escândalo')>0 THEN 'Corrupção'
    WHEN strpos(_txt,'segurança')>0 OR strpos(_txt,'polícia')>0 OR strpos(_txt,'crime')>0 OR strpos(_txt,'violência')>0 OR strpos(_txt,'milícia')>0 OR strpos(_txt,'tráfico')>0 THEN 'Segurança pública'
    WHEN strpos(_txt,'economia')>0 OR strpos(_txt,'emprego')>0 OR strpos(_txt,'inflação')>0 OR strpos(_txt,'imposto')>0 OR strpos(_txt,'salário')>0 OR strpos(_txt,'pib')>0 THEN 'Economia'
    WHEN strpos(_txt,'saúde')>0 OR strpos(_txt,'sus')>0 OR strpos(_txt,'hospital')>0 OR strpos(_txt,'vacina')>0 THEN 'Saúde'
    WHEN strpos(_txt,'educação')>0 OR strpos(_txt,'escola')>0 OR strpos(_txt,'professor')>0 OR strpos(_txt,'universidade')>0 OR strpos(_txt,'enem')>0 THEN 'Educação'
    WHEN strpos(_txt,'obra')>0 OR strpos(_txt,'transporte')>0 OR strpos(_txt,'metrô')>0 OR strpos(_txt,'estrada')>0 OR strpos(_txt,'moradia')>0 THEN 'Infraestrutura'
    WHEN strpos(_txt,'ambiente')>0 OR strpos(_txt,'amazônia')>0 OR strpos(_txt,'desmatamento')>0 OR strpos(_txt,'clima')>0 THEN 'Meio ambiente'
    WHEN strpos(_txt,'bolsa família')>0 OR strpos(_txt,'auxílio')>0 OR strpos(_txt,'aposentadoria')>0 OR strpos(_txt,'inss')>0 THEN 'Programas sociais'
    WHEN strpos(_txt,'governo')>0 OR strpos(_txt,'presidente')>0 OR strpos(_txt,'lula')>0 OR strpos(_txt,'bolsonaro')>0 OR strpos(_txt,'ministro')>0 THEN 'Governo'
    WHEN strpos(_txt,'congresso')>0 OR strpos(_txt,'senado')>0 OR strpos(_txt,'câmara')>0 OR strpos(_txt,'deputado')>0 THEN 'Congresso'
    ELSE NULL
  END
$$;

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
  v_prev_since timestamptz := (current_date - ((v_days * 2) - 1))::timestamptz;
  v_cache_key text;
  v_cached jsonb;
  v_started timestamptz := clock_timestamp();
  v_duration int;
  v_response jsonb;
  v_source_rows bigint := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada.'); END IF;
  PERFORM set_config('statement_timeout','25000', true);

  v_cache_key := 'network_view:topics:v3:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
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
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
      AND (si.post_title IS NOT NULL OR si.comment_text IS NOT NULL)
  ), previous_rows AS (
    SELECT public.nv_classify_theme(lower(coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,''))) AS theme
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
      AND (si.post_title IS NOT NULL OR si.comment_text IS NOT NULL)
  ), cur AS (
    SELECT theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM current_rows WHERE theme IS NOT NULL GROUP BY theme
  ), prev AS (
    SELECT theme, count(*)::bigint AS prev_mentions FROM previous_rows WHERE theme IS NOT NULL GROUP BY theme
  ), ranked AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM cur c LEFT JOIN prev p USING (theme) WHERE c.mentions > 0
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

CREATE OR REPLACE FUNCTION public.network_view_hashtags_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
  PERFORM set_config('statement_timeout','25000', true);

  v_cache_key := 'network_view:hashtags:v3:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'hashtags' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'') AS txt,
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative'
        ELSE 'neutral' END AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
      AND (position('#' in coalesce(si.post_title,'')) > 0 OR position('#' in coalesce(si.comment_text,'')) > 0)
  ), previous_rows AS (
    SELECT coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'') AS txt
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
      AND (position('#' in coalesce(si.post_title,'')) > 0 OR position('#' in coalesce(si.comment_text,'')) > 0)
  ), cur_matches AS (
    SELECT lower((m)[1]) AS tag, sent FROM current_rows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇáàâãéèêíìîóòôõúùûçÑñ]+)', 'g') AS m
  ), prev_matches AS (
    SELECT lower((m)[1]) AS tag FROM previous_rows
    CROSS JOIN LATERAL regexp_matches(txt, '#([[:alnum:]_ÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇáàâãéèêíìîóòôõúùûçÑñ]+)', 'g') AS m
  ), cur AS (
    SELECT tag, count(*)::bigint AS c,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM cur_matches WHERE public.nv_is_valid_hashtag(tag) GROUP BY tag
  ), prev AS (
    SELECT tag, count(*)::bigint AS prev_c FROM prev_matches WHERE public.nv_is_valid_hashtag(tag) GROUP BY tag
  ), ranked AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM cur c LEFT JOIN prev p USING (tag) ORDER BY c.c DESC LIMIT 20
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

DELETE FROM public.network_view_cache WHERE section IN ('topics','hashtags');
