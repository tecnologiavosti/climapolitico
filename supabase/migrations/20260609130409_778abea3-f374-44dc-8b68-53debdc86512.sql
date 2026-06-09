CREATE INDEX IF NOT EXISTS idx_si_nv_published_engagement
ON public.social_interactions (original_posted_at DESC, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC)
WHERE original_posted_at IS NOT NULL AND comment_text IS NOT NULL AND length(comment_text) > 0;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_published_engagement
ON public.social_interactions (user_id, original_posted_at DESC, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC)
WHERE original_posted_at IS NOT NULL AND comment_text IS NOT NULL AND length(comment_text) > 0;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_published_engagement
ON public.social_interactions (user_id, candidate_id, original_posted_at DESC, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC)
WHERE original_posted_at IS NOT NULL AND comment_text IS NOT NULL AND length(comment_text) > 0;

CREATE INDEX IF NOT EXISTS idx_si_nv_user_network_published_engagement
ON public.social_interactions (user_id, social_network, original_posted_at DESC, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC)
WHERE original_posted_at IS NOT NULL AND comment_text IS NOT NULL AND length(comment_text) > 0;

CREATE OR REPLACE FUNCTION public.nv_clean_text(_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(regexp_replace(
    regexp_replace(
      translate(
        lower(coalesce(_text,'')),
        chr(8203) || chr(8204) || chr(8205) || chr(65279) || chr(160) || chr(8288),
        '      '
      ),
      '&(#x?[0-9a-f]+|nbsp|amp|quot|apos|lt|gt);', ' ', 'gi'
    ),
    '\s+', ' ', 'g'
  ));
$$;

CREATE OR REPLACE FUNCTION public.nv_normalize_hashtag(_tag text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH cleaned AS (
    SELECT translate(
      regexp_replace(
        regexp_replace(
          regexp_replace(public.nv_clean_text(coalesce(_tag,'')), '^#+', ''),
          '(brasil|br|2024|2025|2026|2027|2028|2029|oficial)$', '', 'i'
        ),
        '[^a-z0-9_áàãâäéèêëíìîïóòõôöúùûüçñ-]+', '', 'g'
      ),
      'áàãâäéèêëíìîïóòõôöúùûüçñ',
      'aaaaaeeeeiiiiooooouuuucn'
    ) AS tag
  )
  SELECT nullif(regexp_replace(tag, '(^[_-]+|[_-]+$)', '', 'g'), '') FROM cleaned;
$$;

CREATE OR REPLACE FUNCTION public.nv_is_valid_hashtag(_tag text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH n AS (SELECT public.nv_normalize_hashtag(_tag) AS tag)
  SELECT tag IS NOT NULL
    AND length(tag) BETWEEN 3 AND 40
    AND tag ~ '[a-z]'
    AND tag !~ '^[0-9_-]+$'
    AND tag !~* '^[0-9a-f]{3}$'
    AND tag !~* '^[0-9a-f]{6}$'
    AND tag !~* '^[0-9a-f]{8}$'
    AND tag !~* '^(x200b|xfeff|nbsp|amp|quot|apos|zwj|zwnj|null|undefined|nan)$'
    AND tag NOT IN ('rt','via','http','https','www','com','br','amp','utm','href','src','img','div','span','class','style','color','rgb','rgba','hsl','px','rem','x200b','xfeff','nbsp')
  FROM n;
$$;

CREATE OR REPLACE FUNCTION public.nv_political_relevance_score(_text text, _candidate_name text DEFAULT NULL)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH input AS (
    SELECT public.nv_clean_text(coalesce(_text,'')) AS txt,
           public.nv_clean_text(coalesce(_candidate_name,'')) AS cand
  ), terms AS (
    SELECT term
    FROM input, unnest(regexp_split_to_array(cand, '\s+')) AS term
    WHERE length(term) > 2 AND term NOT IN ('dos','das','com','para','por','de','da','do','e')
  ), scored AS (
    SELECT
      (
        CASE WHEN EXISTS (SELECT 1 FROM terms WHERE position(term IN txt) > 0) THEN 0.35 ELSE 0 END +
        CASE WHEN txt ~ '(politic|governo|governador|prefeit|presidente|minister|secretari|eleic|eleiç|voto|urna|campanha|candidat|partido|pt|pl|psdb|mdb|psol|psb|pdt|novo|uniao|união|republicanos|congresso|camara|câmara|senado|deputad|senador|vereador|stf|supremo|tse|planalto|brasilia|brasília|moraes|barroso|gilmar|fachin|dino|lula|bolsonaro|haddad|tarcisio|zema|boulos|nikolas|janja|alckmin)' THEN 0.45 ELSE 0 END +
        CASE WHEN txt ~ '(reforma tribut|imposto|tribut|orcament|orçament|fiscal|selic|juros|inflac|inflaç|pib|desemprego|emprego|bolsa familia|bolsa família|auxilio|auxílio|seguranca publica|segurança publica|policia|polícia|crime|violencia|violência|facç|facc|milicia|milícia|corrup|propina|lava jato|cpi|cpmi|anistia|8 de janeiro|democracia|ditadura|direitos humanos|saude publica|saúde pública|educacao publica|educação pública|politicas publicas|políticas públicas)' THEN 0.35 ELSE 0 END +
        CASE WHEN txt ~ '(brics|onu|otan|mercosul|maduro|trump|biden|putin|milei|venezuela|argentina|china|gaza|israel|ucrania|ucrân)' THEN 0.2 ELSE 0 END
      ) AS raw_score,
      (txt ~ '(futebol|neymar|santos fc|palmeiras|corinthians|flamengo|vasco|gremio|grêmio|botafogo|serie a|campeonato|libertadores|celebridade|celebridades|humor|meme|entretenimento|novela|bbb|games|gameplay|musica|música|show|cantor|atriz|ator|esporte|esportes)') AS non_political_noise
    FROM input
  )
  SELECT CASE
    WHEN raw_score <= 0 THEN 0::numeric
    WHEN non_political_noise AND raw_score < 0.45 THEN 0::numeric
    WHEN non_political_noise THEN least(1::numeric, (raw_score * 0.55)::numeric)
    ELSE least(1::numeric, raw_score::numeric)
  END
  FROM scored;
$$;

CREATE OR REPLACE FUNCTION public.nv_is_political_text(_text text, _candidate_name text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.nv_political_relevance_score(_text, _candidate_name) >= 0.25;
$$;

CREATE OR REPLACE FUNCTION public.refresh_network_view_daily_metrics(p_since date DEFAULT (current_date - 30))
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
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem atualizar métricas agregadas.';
  END IF;

  DROP TABLE IF EXISTS _nv_base;
  CREATE TEMP TABLE _nv_base ON COMMIT DROP AS
  SELECT si.id, si.user_id, si.candidate_id, coalesce(nullif(si.social_network,''),'outro') AS network,
    (coalesce(si.original_posted_at, si.created_at, si.collected_at))::date AS metric_date,
    coalesce(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
    si.original_posted_at, si.collected_at, si.created_at,
    public.nv_clean_text(concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS text_blob,
    si.comment_author,
    COALESCE(si.likes_count,0)::bigint AS likes,
    COALESCE(si.replies_count,0)::bigint AS replies,
    COALESCE(si.shares_count,0)::bigint AS shares,
    public.network_view_sentiment(si.sentiment_label) AS sent,
    c.full_name AS candidate_name,
    public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name) AS political_score
  FROM public.social_interactions si
  JOIN public.candidates c ON c.id = si.candidate_id
  WHERE coalesce(si.original_posted_at, si.created_at, si.collected_at) >= p_since::timestamptz
    AND si.user_id IS NOT NULL AND si.candidate_id IS NOT NULL
    AND coalesce(nullif(si.social_network,''),'outro') NOT IN ('mastodon','lemmy','pinterest','gdelt');

  CREATE INDEX ON _nv_base (user_id, candidate_id, network, metric_date);
  CREATE INDEX ON _nv_base (political_score) WHERE political_score >= 0.25;

  DELETE FROM public.daily_candidate_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_candidate_metrics (metric_date,user_id,candidate_id,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL OR sent='unknown')
  FROM _nv_base GROUP BY 1,2,3;
  GET DIAGNOSTICS v_cand_rows = ROW_COUNT;

  DELETE FROM public.daily_network_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_network_metrics (metric_date,user_id,candidate_id,network,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id,network, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL OR sent='unknown')
  FROM _nv_base GROUP BY 1,2,3,4;
  GET DIAGNOSTICS v_net_rows = ROW_COUNT;

  DELETE FROM public.daily_sentiment_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_sentiment_metrics (metric_date,user_id,candidate_id,network,sentiment,mentions,engagement)
  SELECT metric_date,user_id,candidate_id,network, coalesce(sent,'unknown'), count(*)::bigint, sum(likes+replies+shares)
  FROM _nv_base GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_sent_rows = ROW_COUNT;

  DELETE FROM public.daily_heatmap_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_heatmap_metrics (metric_date,user_id,candidate_id,network,dow,hr,mentions)
  SELECT metric_date,user_id,candidate_id,network,
    extract(dow FROM effective_at)::smallint, extract(hour FROM effective_at)::smallint, count(*)::bigint
  FROM _nv_base GROUP BY 1,2,3,4,5,6;
  GET DIAGNOSTICS v_heat_rows = ROW_COUNT;

  DELETE FROM public.daily_hashtag_metrics WHERE metric_date >= p_since;
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

  DELETE FROM public.daily_topic_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_topic_metrics (metric_date,user_id,candidate_id,network,theme,mentions,positive_count,negative_count,neutral_count)
  WITH dict(theme,pattern) AS (VALUES
    ('Eleições','(eleic|eleiç|voto|urna|campanha|candidat|tse|coligac|debate eleitoral|pesquisa eleitoral|datafolha|quaest|ipec|atlas intel)'),
    ('Governo','(governo|planalto|presidente|presidencia|ministerio|ministro|secretaria|gestao publica|executivo)'),
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

  RETURN jsonb_build_object('candidate_rows',v_cand_rows,'network_rows',v_net_rows,'sentiment_rows',v_sent_rows,'hashtag_rows',v_hash_rows,'topic_rows',v_topic_rows,'heatmap_rows',v_heat_rows,'since',p_since);
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
  v_network text := nullif(nullif(p_network,'all'),'');
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
  v_cache_total bigint := NULL; v_daily_total bigint := NULL; v_divergence numeric := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_core_v6', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  IF v_network IS NULL AND v_days >= 3650 THEN
    SELECT coalesce(sum(total_mentions),0)::bigint INTO v_cache_total
    FROM public.candidate_metrics_cache
    WHERE (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id);
  END IF;

  WITH net AS (
    SELECT metric_date, network, mentions, unique_authors, likes, replies, shares, engagement,
      positive_count, negative_count, neutral_count, unknown_count, (metric_date >= v_since) AS is_current
    FROM public.daily_network_metrics
    WHERE metric_date >= v_prev_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
  ),
  kpis AS (
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
  ),
  series AS (
    SELECT to_char(metric_date,'YYYY-MM-DD') AS day,
      sum(positive_count)::bigint AS p, sum(negative_count)::bigint AS n, sum(neutral_count + unknown_count)::bigint AS u
    FROM net WHERE is_current GROUP BY 1
  ),
  by_net AS (
    SELECT network, sum(mentions)::bigint AS mentions, sum(likes)::bigint AS likes,
      sum(replies)::bigint AS replies, sum(shares)::bigint AS shares, sum(engagement)::bigint AS engagement
    FROM net WHERE is_current GROUP BY 1
  ),
  heat AS (
    SELECT dow::int AS dow, hr::int AS hr, sum(mentions)::bigint AS c
    FROM public.daily_heatmap_metrics
    WHERE metric_date >= v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1,2
  )
  SELECT jsonb_build_object(
    'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
    'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
  ) INTO v_data;

  v_daily_total := coalesce((v_data #>> '{kpis,total}')::bigint,0);
  IF v_cache_total IS NOT NULL AND v_cache_total > 0 THEN
    v_divergence := abs(v_cache_total - v_daily_total)::numeric / v_cache_total::numeric;
    IF v_divergence <= 0.01 THEN
      v_data := jsonb_set(v_data, '{kpis,total}', to_jsonb(v_cache_total), true);
    END IF;
  END IF;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,v_daily_total,v_duration,jsonb_build_object('source','daily_aggregates','overview_total',v_cache_total,'divergence',v_divergence), now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_aggregates','overview_total',v_cache_total,'divergence',v_divergence));
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
  v_network text := nullif(nullif(p_network,'all'),'');
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_content_v6', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
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
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1
  ), t_prev AS (
    SELECT theme, sum(mentions)::bigint AS prev_mentions
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
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
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1
  ), h_prev AS (
    SELECT tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
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
  v_network text := nullif(nullif(p_network,'all'),'');
  v_since timestamptz := now() - make_interval(days => v_days);
  v_until timestamptz := now();
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_top_v6', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH cands AS MATERIALIZED (
    SELECT si.id, si.social_network, si.comment_text, si.comment_author,
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
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
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

DO $$ BEGIN PERFORM cron.unschedule('refresh-network-view-daily-metrics'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'refresh-network-view-daily-metrics',
  '*/15 * * * *',
  $cmd$ SELECT public.refresh_network_view_daily_metrics(current_date - 30); $cmd$
);

DELETE FROM public.network_view_cache;