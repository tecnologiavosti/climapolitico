CREATE OR REPLACE FUNCTION public.nv_network_key(_network text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(coalesce(_network,'')) IN ('youtube','yt') THEN 'youtube'
    WHEN lower(coalesce(_network,'')) IN ('twitter','x','twitter/x','x / twitter') THEN 'twitter'
    WHEN lower(coalesce(_network,'')) IN ('google_news','googlenews','google news','notícias','noticias') THEN 'google_news'
    WHEN lower(coalesce(_network,'')) IN ('tik_tok','tiktok','tik tok') THEN 'tiktok'
    WHEN lower(coalesce(_network,'')) IN ('facebook','fb') THEN 'facebook'
    WHEN lower(coalesce(_network,'')) IN ('instagram','ig') THEN 'instagram'
    WHEN lower(coalesce(_network,'')) IN ('telegram') THEN 'telegram'
    WHEN lower(coalesce(_network,'')) IN ('reddit') THEN 'reddit'
    WHEN lower(coalesce(_network,'')) IN ('linkedin','linkedIn') THEN 'linkedin'
    ELSE lower(regexp_replace(coalesce(_network,'outro'), '\s+', '_', 'g'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_network_view_daily_metrics_range(p_since date, p_until date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
DECLARE
  v_cand_rows int := 0; v_net_rows int := 0; v_sent_rows int := 0;
  v_hash_rows int := 0; v_topic_rows int := 0; v_heat_rows int := 0;
BEGIN
  IF p_since IS NULL OR p_until IS NULL OR p_until <= p_since THEN
    RAISE EXCEPTION 'Intervalo inválido para atualização de métricas.';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem atualizar métricas agregadas.';
  END IF;

  DROP TABLE IF EXISTS _nv_base;
  CREATE TEMP TABLE _nv_base ON COMMIT DROP AS
  SELECT si.id, si.user_id, si.candidate_id, public.nv_network_key(si.social_network) AS network,
    (coalesce(si.original_posted_at, si.created_at, si.collected_at))::date AS metric_date,
    coalesce(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
    public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS text_blob,
    si.comment_author,
    COALESCE(si.likes_count,0)::bigint AS likes,
    COALESCE(si.replies_count,0)::bigint AS replies,
    COALESCE(si.shares_count,0)::bigint AS shares,
    public.network_view_sentiment(si.sentiment_label) AS sent,
    public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name) AS political_score
  FROM public.social_interactions si
  JOIN public.candidates c ON c.id = si.candidate_id
  WHERE coalesce(si.original_posted_at, si.created_at, si.collected_at) >= p_since::timestamptz
    AND coalesce(si.original_posted_at, si.created_at, si.collected_at) < p_until::timestamptz
    AND si.user_id IS NOT NULL AND si.candidate_id IS NOT NULL
    AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt');

  CREATE INDEX ON _nv_base (user_id, candidate_id, network, metric_date);
  CREATE INDEX ON _nv_base (political_score) WHERE political_score >= 0.25;

  DELETE FROM public.daily_candidate_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_candidate_metrics (metric_date,user_id,candidate_id,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL OR sent='unknown')
  FROM _nv_base GROUP BY 1,2,3;
  GET DIAGNOSTICS v_cand_rows = ROW_COUNT;

  DELETE FROM public.daily_network_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_network_metrics (metric_date,user_id,candidate_id,network,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id,network, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL OR sent='unknown')
  FROM _nv_base GROUP BY 1,2,3,4;
  GET DIAGNOSTICS v_net_rows = ROW_COUNT;

  DELETE FROM public.daily_sentiment_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_sentiment_metrics (metric_date,user_id,candidate_id,network,sentiment,mentions,engagement)
  SELECT metric_date,user_id,candidate_id,network, coalesce(sent,'unknown'), count(*)::bigint, sum(likes+replies+shares)
  FROM _nv_base GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_sent_rows = ROW_COUNT;

  DELETE FROM public.daily_heatmap_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_heatmap_metrics (metric_date,user_id,candidate_id,network,dow,hr,mentions)
  SELECT metric_date,user_id,candidate_id,network,
    extract(dow FROM effective_at)::smallint, extract(hour FROM effective_at)::smallint, count(*)::bigint
  FROM _nv_base GROUP BY 1,2,3,4,5,6;
  GET DIAGNOSTICS v_heat_rows = ROW_COUNT;

  DELETE FROM public.daily_hashtag_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_hashtag_metrics (metric_date,user_id,candidate_id,network,tag,mentions,positive_count,negative_count,neutral_count)
  SELECT x.metric_date,x.user_id,x.candidate_id,x.network,'#'||x.tag,
    count(*)::bigint,
    count(*) FILTER (WHERE x.sent='positive')::bigint,
    count(*) FILTER (WHERE x.sent='negative')::bigint,
    count(*) FILTER (WHERE x.sent='neutral')::bigint
  FROM (
    SELECT b.metric_date,b.user_id,b.candidate_id,b.network,b.sent, public.nv_normalize_hashtag(m[1]) AS tag
    FROM _nv_base b, regexp_matches(coalesce(b.text_blob,''), '#([[:alnum:]_áéíóúâêîôûãõçñ-]{3,40})', 'g') AS m
    WHERE b.political_score >= 0.25
  ) x
  WHERE public.nv_is_valid_hashtag(x.tag)
  GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_hash_rows = ROW_COUNT;

  DELETE FROM public.daily_topic_metrics WHERE metric_date >= p_since AND metric_date < p_until;
  INSERT INTO public.daily_topic_metrics (metric_date,user_id,candidate_id,network,theme,mentions,positive_count,negative_count,neutral_count)
  WITH dict(theme,pattern) AS (VALUES
    ('Eleições','(eleic|eleiç|voto|urna|campanha|candidat|tse|coligac|debate eleitoral|pesquisa eleitoral|datafolha|quaest|ipec|atlas intel)'),
    ('Governo','(governo|planalto|presidente|presidencia|minist|secretaria|gestao publica|executivo)'),
    ('Congresso','(camara|câmara|congresso|deputad|senado|senador|cpi|cpmi|emenda parlamentar|lira|pacheco)'),
    ('STF e Justiça','(stf|supremo|moraes|barroso|gilmar|fachin|toffoli|fux|dino|tse|tcu|justica eleitoral|justiça eleitoral|julgamento|inelegib|cassac|cassação)'),
    ('Economia Pública','(econom|inflac|inflaç|desemprego|emprego|salario|salário|pib|imposto|tribut|juros|selic|dolar|dólar|fiscal|orcament|orçament|bolsa familia|bolsa família|auxilio|auxílio|arcabouco|arcabouço)'),
    ('Segurança Pública','(seguranca publica|segurança publica|violencia|violência|policia|polícia|crime|homicid|trafic|facç|facc|milicia|milícia|pcc|cv)'),
    ('Corrupção','(corrup|propina|desvio|lava jato|peculato|escandal|escândal|delaç|delac)'),
    ('Reformas e Leis','(reforma tribut|reforma administrativa|previdencia|previdência|pec|medida provisoria|medida provisória|lei complementar|regulamentac|regulamentação)'),
    ('8 de Janeiro e Democracia','(anistia|8 de janeiro|janeiro de 2023|golpe|golpist|democracia|ditadura|autoritari)'),
    ('Política Internacional','(brics|onu|otan|mercosul|maduro|trump|biden|putin|milei|venezuela|argentina|china|gaza|israel|ucrania|ucrân)'),
    ('Direitos e Políticas Sociais','(direitos humanos|lgbt|racism|feminis|aborto|igualdade|minoria|indigen|saude publica|saúde pública|educacao publica|educação pública|moradia|assistencia social|assistência social)'),
    ('Partidos e Ideologia','(pt|pl|psdb|mdb|psol|psb|pdt|novo|uniao brasil|união brasil|republicanos|direita|esquerda|conservador|progressista|bolsonarist|petist|lulist)'),
    ('Candidatos e Lideranças','(lula|bolsonaro|haddad|tarcisio|zema|boulos|nikolas|janja|alckmin|gleisi|lira|pacheco|moraes)')
  ), matches AS (
    SELECT b.metric_date,b.user_id,b.candidate_id,b.network,d.theme,b.sent
    FROM _nv_base b JOIN dict d ON b.political_score >= 0.25 AND b.text_blob ~ d.pattern
    UNION ALL
    SELECT b.metric_date,b.user_id,b.candidate_id,b.network,'Debate político geral' AS theme,b.sent
    FROM _nv_base b
    WHERE b.political_score >= 0.25
      AND NOT EXISTS (SELECT 1 FROM dict d WHERE b.text_blob ~ d.pattern)
  )
  SELECT metric_date,user_id,candidate_id,network,theme,
    count(*)::bigint,
    count(*) FILTER (WHERE sent='positive')::bigint,
    count(*) FILTER (WHERE sent='negative')::bigint,
    count(*) FILTER (WHERE sent='neutral')::bigint
  FROM matches GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_topic_rows = ROW_COUNT;

  DELETE FROM public.network_view_cache;
  RETURN jsonb_build_object('candidate_rows',v_cand_rows,'network_rows',v_net_rows,'sentiment_rows',v_sent_rows,'hashtag_rows',v_hash_rows,'topic_rows',v_topic_rows,'heatmap_rows',v_heat_rows,'since',p_since,'until',p_until);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics_range(date,date) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics_range(date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_network_view_daily_metrics(p_since date DEFAULT (current_date - 30))
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '0'
AS $$
BEGIN
  RETURN public.refresh_network_view_daily_metrics_range(p_since, current_date + 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics(date) TO authenticated, service_role;

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
  v_network text := public.nv_network_key(nullif(nullif(p_network,'all'),''));
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_core_v7', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
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

DELETE FROM public.network_view_cache;