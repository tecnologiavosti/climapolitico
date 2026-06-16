
-- Faster sentiment block: use existing sentiment_label directly (no text concat, no helper)
CREATE OR REPLACE FUNCTION public.network_view_sentiment_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
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

  v_cache_key := 'network_view:sentiment:v2:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'sentiment' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT
      COALESCE(si.original_posted_at, si.collected_at, si.created_at) AS ts,
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive' WHEN 'pos' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative' WHEN 'neg' THEN 'negative'
        ELSE 'neutral'
      END AS sent
    FROM public.social_interactions si
    WHERE si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) IS NOT NULL
      AND (v_is_total_period OR COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_since)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) <= now()
  ), previous_rows AS (
    SELECT
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive' WHEN 'pos' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative' WHEN 'neg' THEN 'negative'
        ELSE 'neutral'
      END AS sent
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
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM current_rows
  ), prev_counts AS (
    SELECT
      count(*) FILTER (WHERE sent = 'positive')::bigint AS prev_pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS prev_neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS prev_neu
    FROM previous_rows
  ), series AS (
    SELECT to_char(date_trunc('day', ts)::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS u
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

-- Faster topics block: only post_title + comment_text; sentiment from label directly
CREATE OR REPLACE FUNCTION public.network_view_topics_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
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
  v_cache_key := 'network_view:topics:v2:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND section = 'topics' AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_set(v_cached, '{diagnostics,cache_hit}', 'true'::jsonb, true);
  END IF;

  WITH current_rows AS (
    SELECT lower(coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'')) AS txt,
      CASE lower(coalesce(si.sentiment_label,''))
        WHEN 'positivo' THEN 'positive' WHEN 'positive' THEN 'positive'
        WHEN 'negativo' THEN 'negative' WHEN 'negative' THEN 'negative'
        ELSE 'neutral'
      END AS sent
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
    SELECT lower(coalesce(si.post_title,'') || ' ' || coalesce(si.comment_text,'')) AS txt
    FROM public.social_interactions si
    WHERE NOT v_is_total_period
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.collected_at, si.created_at) < v_since
      AND (si.post_title IS NOT NULL OR si.comment_text IS NOT NULL)
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
      ELSE NULL END AS theme, sent
    FROM current_rows
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
      ELSE NULL END AS theme
    FROM previous_rows
  ), cur AS (
    SELECT theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
    FROM cur_topics WHERE theme IS NOT NULL GROUP BY theme
  ), prev AS (
    SELECT theme, count(*)::bigint AS prev_mentions FROM prev_topics WHERE theme IS NOT NULL GROUP BY theme
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

-- Faster hashtags block: cheap per-column '#' check; only post_title + comment_text
CREATE OR REPLACE FUNCTION public.network_view_hashtags_block(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
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
  v_cache_key := 'network_view:hashtags:v2:' || v_uid::text || ':' || coalesce(p_candidate_id::text,'all') || ':' || coalesce(v_network,'all') || ':' || v_days::text;
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
        ELSE 'neutral'
      END AS sent
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
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu
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

-- Clear caches so the new logic runs immediately
DELETE FROM public.network_view_cache WHERE section IN ('sentiment','topics','hashtags');
