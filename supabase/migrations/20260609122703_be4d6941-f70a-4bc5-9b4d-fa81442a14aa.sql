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
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  v_network text := nullif(nullif(p_network, 'all'), '');
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)));
  v_prev_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)) * 2);
  v_limit integer := CASE WHEN coalesce(p_days, 30) > 365 THEN 1200 ELSE 2500 END;
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
  v_plan jsonb := jsonb_build_object(
    'query', 'network_view_content_metrics',
    'strategy', 'bounded recent sample; regex processing isolated and capped',
    'sample_limit_per_period', CASE WHEN coalesce(p_days, 30) > 365 THEN 1200 ELSE 2500 END,
    'expensive_operations', jsonb_build_array('regex topic matching', 'regexp hashtag extraction'),
    'indexes', jsonb_build_array('idx_si_nv_user_collected', 'idx_si_nv_user_candidate_collected', 'idx_si_nv_user_network_collected')
  );
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada. Entre novamente para carregar os dados.', 'diagnostics', jsonb_build_object('status', 'not_authenticated'));
  END IF;

  v_cache_key := md5(concat_ws('|', 'network_view_content_v2', v_uid::text, coalesce(p_candidate_id::text, 'all'), coalesce(v_network, 'all'), v_days::text));

  SELECT result INTO v_cached
  FROM public.network_view_cache
  WHERE cache_key = v_cache_key AND expires_at > now();

  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'content', p_candidate_id, v_network, v_days, true, v_duration, 0, 1, 'success', NULL, v_plan || jsonb_build_object('cache', 'hit'));
    RETURN jsonb_build_object('ok', true, 'data', v_cached, 'diagnostics', jsonb_build_object('cache_hit', true, 'duration_ms', v_duration, 'records_read', 0, 'records_returned', 1, 'plan', v_plan));
  END IF;

  WITH theme_dict(theme, pattern) AS (
    VALUES
      ('Economia', '(econom|inflaç|desemprego|emprego|salári|pib|imposto|tribut|juros?|selic|dólar|dolar|mercado|fiscal|orçament|reforma trib|gasolina|combustív|preço|carestia|pobreza|renda|bolsa famíli|auxíli)'),
      ('Segurança', '(segurança|violênci|polícia|policia|crime|bandid|armas?|porte de arma|narcotráfic|tráfic|homicíd|assalt|roubo|facç|milíci|pcc|cv)'),
      ('Educação', '(educaç|escola|universidad|professor|aluno|enem|fies|prouni|creche|analfabet|ensino)'),
      ('Saúde', '(saúde|sus|hospital|médic|vacin|doenç|pandemi|covid|posto de saúde|farmáci|remédi|dengue)'),
      ('Eleições', '(eleiç|voto|candidat|urna|campanha|partido|tse|coligaç|debate|pesquisa eleitoral|datafolha|quaest|ipec)'),
      ('Corrupção', '(corrupç|propina|desvio|lava jato|fraud|peculato|escândal|cpmi|cpi)'),
      ('Meio Ambiente', '(meio ambient|amazôni|amazonia|desmatament|climátic|sustentab|queimad|indígen|cop[0-9]+)'),
      ('Direitos', '(direitos humanos|lgbt|lgbtq|racism|negros?|mulher|feminis|aborto|igualdade|minoria)'),
      ('Religião', '(igreja|cristã|cristao|evangéli|católic|deus|pastor|padre|fé|religi)'),
      ('Infraestrutura', '(infraestrutur|obras|estrada|rodovi|ponte|saneament|transport|metrô|metro|ônibus|onibus|mobilidade)'),
      ('Tecnologia', '(tecnolog|inteligência artificial|ia\y|inovaç|startup|digital|internet|5g|cibern)'),
      ('Trabalho', '(trabalh|clt|carteira assinada|sindicat|greve|terceirizaç|reforma trabal)'),
      ('Agronegócio', '(agro|agronegóci|fazend|soja|pecuári|produtor rural|mst|reforma agrári)')
  ),
  cur AS MATERIALIZED (
    SELECT si.comment_text, public.network_view_sentiment(si.sentiment_label) AS sent
    FROM public.social_interactions si
    WHERE si.collected_at >= v_since
      AND si.comment_text IS NOT NULL
      AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY si.collected_at DESC
    LIMIT v_limit
  ),
  prev AS MATERIALIZED (
    SELECT si.comment_text, public.network_view_sentiment(si.sentiment_label) AS sent
    FROM public.social_interactions si
    WHERE si.collected_at >= v_prev_since
      AND si.collected_at < v_since
      AND si.comment_text IS NOT NULL
      AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY si.collected_at DESC
    LIMIT v_limit
  ),
  topic_matches AS (
    SELECT td.theme, c.sent FROM cur c JOIN theme_dict td ON c.comment_text ~* td.pattern
  ),
  topic_prev AS (
    SELECT td.theme, count(*)::bigint AS prev_mentions FROM prev p JOIN theme_dict td ON p.comment_text ~* td.pattern GROUP BY td.theme
  ),
  topics AS (
    SELECT tm.theme, count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      coalesce((SELECT prev_mentions FROM topic_prev tp WHERE tp.theme = tm.theme), 0)::bigint AS prev_mentions
    FROM topic_matches tm GROUP BY tm.theme ORDER BY mentions DESC LIMIT 20
  ),
  explicit_tags AS (
    SELECT lower(m[1]) AS raw_tag, c.sent FROM cur c, regexp_matches(coalesce(c.comment_text, ''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  explicit_tags_prev AS (
    SELECT lower(m[1]) AS raw_tag FROM prev p, regexp_matches(coalesce(p.comment_text, ''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  tag_norm AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag, sent FROM explicit_tags
  ),
  tag_norm_prev AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag FROM explicit_tags_prev
  ),
  explicit_grouped AS (
    SELECT tag, count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM tag_norm_prev tp WHERE tp.tag = tn.tag) AS prev_mentions
    FROM tag_norm tn WHERE length(tag) >= 2 GROUP BY tag
  ),
  hashtags AS (
    SELECT '#' || tag AS tag, sum(mentions)::bigint AS c, sum(pos)::bigint AS pos, sum(neg)::bigint AS neg, sum(neu)::bigint AS neu, sum(prev_mentions)::bigint AS prev_c
    FROM (
      SELECT tag, mentions, pos, neg, neu, prev_mentions FROM explicit_grouped
      UNION ALL
      SELECT lower(theme), mentions, pos, neg, neu, prev_mentions FROM topics
    ) h
    GROUP BY tag ORDER BY c DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'hashtags', (SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC), '[]'::jsonb) FROM hashtags),
    'topics', (SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC), '[]'::jsonb) FROM topics)
  ),
  ((SELECT count(*) FROM cur) + (SELECT count(*) FROM prev))::bigint
  INTO v_data, v_records_read;

  v_records_returned := coalesce(jsonb_array_length(v_data->'hashtags'), 0) + coalesce(jsonb_array_length(v_data->'topics'), 0);
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, plan, expires_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, v_network, v_days, 'content', v_data, v_records_read, v_duration, v_plan, now() + interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, source_rows = EXCLUDED.source_rows, duration_ms = EXCLUDED.duration_ms, plan = EXCLUDED.plan, expires_at = EXCLUDED.expires_at, updated_at = now();

  PERFORM public.log_network_view_query(v_uid, 'content', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'success', NULL, v_plan);
  RETURN jsonb_build_object('ok', true, 'data', v_data, 'diagnostics', jsonb_build_object('cache_hit', false, 'duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'plan', v_plan));
EXCEPTION
  WHEN query_canceled THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'content', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'timeout', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'A consulta de assuntos e hashtags excedeu o tempo limite.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
  WHEN OTHERS THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'content', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'error', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar assuntos e hashtags.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_content_metrics(uuid, text, integer) TO authenticated;