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
SET statement_timeout = '45s'
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

  v_cache_key := md5(concat_ws('|','nv_content_raw_v13', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions'));
  END IF;

  WITH dict(theme, pattern) AS (VALUES
    ('Eleições','(eleic|eleiç|voto|urna|campanha|candidat|tse|pesquisa eleitoral|datafolha|quaest|ipec)'),
    ('Governo','(governo|planalto|presidente|minister|secretaria|executivo)'),
    ('Congresso','(camara|câmara|congresso|deputad|senado|senador|cpi|cpmi|emenda parlamentar|lira|pacheco)'),
    ('STF e Justiça','(stf|supremo|moraes|barroso|gilmar|fachin|dino|tse|julgamento|inelegib|cassac|cassação)'),
    ('Economia Pública','(econom|inflac|inflaç|desemprego|pib|imposto|tribut|juros|selic|fiscal|orcament|orçament|bolsa familia|bolsa família)'),
    ('Segurança Pública','(seguranca publica|segurança publica|violencia|violência|policia|polícia|crime|trafic|facç|facc|milicia|milícia)'),
    ('Corrupção','(corrup|propina|desvio|lava jato|peculato|escandal|escândal)'),
    ('Reformas e Leis','(reforma tribut|previdencia|previdência|pec|medida provisoria|medida provisória|lei complementar)'),
    ('8 de Janeiro e Democracia','(anistia|8 de janeiro|golpe|golpist|democracia|ditadura|autoritari)'),
    ('Política Internacional','(brics|onu|mercosul|maduro|trump|biden|putin|milei|venezuela|argentina|china|gaza|israel|ucrania|ucrân)'),
    ('Saúde e Educação','(sus|saude publica|saúde pública|educacao publica|educação pública|mec|ministério da saúde|ministério da educação)'),
    ('Partidos e Articulação','(pt|pl|psdb|mdb|psol|psb|pdt|novo|união brasil|uniao brasil|republicanos|oposição|oposicao)')
  ), base AS MATERIALIZED (
    SELECT
      COALESCE(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
      public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS text_blob,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= v_since
      AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), hashtag_rows AS MATERIALIZED (
    SELECT public.nv_normalize_hashtag(m[1]) AS tag, b.sent
    FROM (SELECT text_blob, sent FROM base WHERE position('#' in text_blob) > 0 LIMIT 50000) b
    CROSS JOIN LATERAL regexp_matches(b.text_blob, '#([[:alnum:]_áéíóúâêîôûãõçñ-]{3,80})', 'g') AS m
  ), hashtags AS (
    SELECT public.nv_hashtag_display(tag) AS tag,
      count(*)::bigint AS c,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      0::bigint AS prev_c
    FROM hashtag_rows
    WHERE public.nv_is_valid_hashtag(tag)
    GROUP BY 1
    ORDER BY c DESC
    LIMIT 20
  ), topic_hits AS MATERIALIZED (
    SELECT d.theme, b.sent
    FROM base b
    JOIN dict d ON b.text_blob ~ d.pattern
  ), topics AS (
    SELECT theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      0::bigint AS prev_mentions
    FROM topic_hits
    GROUP BY 1
    ORDER BY mentions DESC
    LIMIT 15
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ),
  (SELECT count(*) FROM base),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags)
  INTO v_data, v_records_read, v_records_returned;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records_read,v_duration,'{"source":"social_interactions_raw_content_v13","note":"topics_allow_multiple_per_mention"}'::jsonb,now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'success',NULL,'{"source":"social_interactions","version":"raw_v13"}'::jsonb);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','social_interactions','records_read',v_records_read));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_content_metrics(uuid,text,integer) TO authenticated;

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
  v_result jsonb;
BEGIN
  v_result := public.network_view_core_metrics_v12_impl(p_candidate_id, p_network, p_days);
  RETURN v_result;
EXCEPTION WHEN undefined_function THEN
  RETURN jsonb_build_object('ok',false,'message','Dados em reprocessamento. Atualizando métricas. Recalculando agregações.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar as métricas gerais.');
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid,text,integer) TO authenticated;