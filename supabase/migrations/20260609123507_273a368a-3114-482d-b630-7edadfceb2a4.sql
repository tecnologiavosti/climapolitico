
-- 1. Helper: detecta texto politicamente relevante (BR)
CREATE OR REPLACE FUNCTION public.nv_is_political_text(_text text, _candidate_name text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    coalesce(_text, '') <> '' AND (
      -- Nome do candidato (qualquer parte)
      (_candidate_name IS NOT NULL AND _text ~* ('\m(' || regexp_replace(trim(_candidate_name), '\s+', '|', 'g') || ')\M'))
      OR
      -- Dicionário político brasileiro amplo
      _text ~* '\m(lula|bolsonaro|haddad|tarcisio|zema|ratinho|caiado|nikolas|boulos|janja|alckmin|kassab|gleisi|valdemar|carluxo|flavio bolsonaro|eduardo bolsonaro|michelle|ciro|marina|simone tebet|pacheco|lira|moraes|fachin|barroso|toffoli|gilmar|dino|messias|fux|aras|lewandowski|cármen|carmen|mendonça|nunes marques|kassio)\M'
      OR _text ~* '\m(pt|pl|psdb|mdb|psol|psb|pdt|podemos|novo|republicanos|união|pp|pcdob|patriota|avante|solidariedade|cidadania|rede|psd|dem|democratas)\M'
      OR _text ~* '\m(presidente|presidência|presidencia|governo|governador|prefeito|prefeita|senador|senadora|deputad|vereador|ministr|secretári|secretari)\M'
      OR _text ~* '\m(senado|câmara|camara|congresso|congressional|stf|tse|tcu|cnj|cgu|stm|stj|planalto|esplanada|brasília|brasilia|palácio|palacio)\M'
      OR _text ~* '\m(eleiç|eleic|votaç|votac|urna|tse|partidári|partidari|coligaç|campanha|candidat|comício|comicio|debate eleitoral|pesquisa eleitoral|datafolha|quaest|ipec|paraná pesquisas|atlas intel)\M'
      OR _text ~* '\m(impeachment|cpi|cpmi|inelegibilidade|inelegível|cassação|cassacao|delaç|delac|operação lava jato|stf|jurídic|juridic|julgament|condenaç|condenac|absolviç|absolvic|liminar)\M'
      OR _text ~* '\m(reforma tribut|reforma administrativa|reforma trabal|reforma da previdência|previdencia|teto de gastos|arcabouço|arcabouco|emenda parlamentar|orçament|orcament|pec|mp \d+|medida provisória|lei complement)\M'
      OR _text ~* '\m(brics|otan|onu|mercosul|venezuel|maduro|trump|biden|putin|argentina|milei|china|estados unidos|guerra|ucrân|ucran|israel|gaza|hamas|palestin)\M'
      OR _text ~* '\m(esquerda|direita|extrema|comunist|fascist|liberal|conservador|progressist|bolsonarist|petist|lulist|aliad|opositor|oposiç|opos)\M'
      OR _text ~* '\m(anistia|8 de janeiro|janeiro de 2023|golpe|golpist|democraci|ditadura|ditador|autoritari|autocrac|tirania)\M'
      OR _text ~* '\m(política|politica|político|politico|politicagem|politicament)\M'
    )
$$;

-- 2. Helper: valida hashtag (rejeita hex, números puros, IDs)
CREATE OR REPLACE FUNCTION public.nv_is_valid_hashtag(_tag text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    coalesce(_tag, '') <> ''
    AND length(_tag) BETWEEN 3 AND 40
    -- Deve conter pelo menos uma letra
    AND _tag ~ '[a-záéíóúâêîôûãõçñ]'
    -- Não pode ser puramente numérico
    AND _tag !~ '^[0-9_]+$'
    -- Não pode ser cor hexadecimal (3, 6 ou 8 chars hex)
    AND _tag !~* '^[0-9a-f]{3}$'
    AND _tag !~* '^[0-9a-f]{6}$'
    AND _tag !~* '^[0-9a-f]{8}$'
    -- Não pode ser ID/código com mistura "xx00xx" típico
    AND _tag !~* '^[a-f0-9]{4,}$'
    -- Stop list de lixo recorrente
    AND lower(_tag) NOT IN ('rt','via','http','https','www','com','br','amp','utm','href','src','img','div','span','class','style','color','rgb','rgba','hsl','px','em','rem')
$$;

-- 3. Recriar core_metrics com filtro político e base consistente
DROP FUNCTION IF EXISTS public.network_view_core_metrics(uuid, text, integer);
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
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  v_network text := nullif(nullif(p_network, 'all'), '');
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)));
  v_prev_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)) * 2);
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
  v_candidate_name text;
  v_plan jsonb := jsonb_build_object('query','network_view_core_metrics_v3','filter','political_relevance');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada. Entre novamente para carregar os dados.');
  END IF;

  IF p_candidate_id IS NOT NULL THEN
    SELECT full_name INTO v_candidate_name FROM public.candidates WHERE id = p_candidate_id;
  END IF;

  v_cache_key := md5(concat_ws('|','network_view_core_v3', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));

  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,true,v_duration,0,1,'success',NULL,v_plan);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'duration_ms',v_duration));
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      si.id, si.social_network, si.comment_author,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      si.collected_at, si.original_posted_at,
      (si.collected_at >= v_since) AS is_current
    FROM public.social_interactions si
    WHERE si.collected_at >= v_prev_since
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND public.nv_is_political_text(si.comment_text, v_candidate_name)
  ),
  row_count AS (SELECT count(*)::bigint AS records_read FROM filtered),
  kpis AS (
    SELECT
      count(*) FILTER (WHERE is_current)::bigint AS total,
      count(DISTINCT comment_author) FILTER (WHERE is_current AND comment_author IS NOT NULL)::bigint AS authors,
      coalesce(sum(likes+replies+shares) FILTER (WHERE is_current),0)::bigint AS engagement,
      coalesce(sum(likes) FILTER (WHERE is_current),0)::bigint AS likes,
      coalesce(sum(replies) FILTER (WHERE is_current),0)::bigint AS replies,
      coalesce(sum(shares) FILTER (WHERE is_current),0)::bigint AS shares,
      count(*) FILTER (WHERE is_current AND sent='positive')::bigint AS pos,
      count(*) FILTER (WHERE is_current AND sent='negative')::bigint AS neg,
      count(*) FILTER (WHERE is_current AND sent='neutral')::bigint AS neu,
      count(*) FILTER (WHERE NOT is_current)::bigint AS prev_total,
      count(*) FILTER (WHERE NOT is_current AND sent='positive')::bigint AS prev_pos,
      count(*) FILTER (WHERE NOT is_current AND sent='negative')::bigint AS prev_neg,
      count(*) FILTER (WHERE NOT is_current AND sent='neutral')::bigint AS prev_neu
    FROM filtered
  ),
  series AS (
    SELECT to_char(date_trunc('day', collected_at),'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent='positive')::bigint AS p,
      count(*) FILTER (WHERE sent='negative')::bigint AS n,
      count(*) FILTER (WHERE sent='neutral')::bigint AS u
    FROM filtered WHERE is_current GROUP BY 1
  ),
  by_net AS (
    SELECT social_network AS network,
      count(*)::bigint AS mentions,
      coalesce(sum(likes),0)::bigint AS likes,
      coalesce(sum(replies),0)::bigint AS replies,
      coalesce(sum(shares),0)::bigint AS shares,
      coalesce(sum(likes+replies+shares),0)::bigint AS engagement
    FROM filtered WHERE is_current GROUP BY 1
  ),
  heat AS (
    SELECT extract(dow FROM coalesce(original_posted_at, collected_at))::int AS dow,
      extract(hour FROM coalesce(original_posted_at, collected_at))::int AS hr,
      count(*)::bigint AS c
    FROM filtered WHERE is_current GROUP BY 1,2
  )
  SELECT jsonb_build_object(
    'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
    'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
  ), (SELECT records_read FROM row_count)
  INTO v_data, v_records_read;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started))*1000)::integer;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,v_records_read,v_duration,v_plan,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  PERFORM public.log_network_view_query(v_uid,'core',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,v_records_returned,'success',NULL,v_plan);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'records_read',v_records_read));
EXCEPTION WHEN query_canceled THEN
  RETURN jsonb_build_object('ok',false,'message','A consulta de métricas gerais excedeu o tempo limite.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar as métricas gerais.','diagnostics',jsonb_build_object('error',SQLERRM));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid,text,integer) TO authenticated;

-- 4. Recriar content_metrics com filtro político + hashtag estrita + sem implicit injection
DROP FUNCTION IF EXISTS public.network_view_content_metrics(uuid, text, integer);
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
  v_limit integer := 20000;
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_read bigint := 0;
  v_candidate_name text;
  v_plan jsonb := jsonb_build_object('query','network_view_content_metrics_v3','filter','political+hashtag_validation');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada. Entre novamente para carregar os dados.');
  END IF;

  IF p_candidate_id IS NOT NULL THEN
    SELECT full_name INTO v_candidate_name FROM public.candidates WHERE id = p_candidate_id;
  END IF;

  v_cache_key := md5(concat_ws('|','network_view_content_v3', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));

  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started))*1000)::integer;
    PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,true,v_duration,0,1,'success',NULL,v_plan);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'duration_ms',v_duration));
  END IF;

  WITH theme_dict(theme, pattern) AS (
    VALUES
      ('Eleições',       '(eleiç|eleic|voto|urna|campanha|candidat|tse|coligaç|debate|pesquisa eleitoral|datafolha|quaest|ipec|atlas intel|paraná pesquisas)'),
      ('Governo Federal','(governo federal|planalto|presidente|presidência|presidencia|ministério|ministerio|ministr|esplanada)'),
      ('Congresso',      '(câmara|camara|congresso|deputad|senador|senadora|lira|pacheco|emenda parlamentar)'),
      ('Senado',         '(\msenado\M|senador|senadora|cpi|cpmi)'),
      ('STF',            '(stf|supremo|moraes|toffoli|fachin|barroso|gilmar|fux|aras|lewandowski|mendonça|nunes marques|cármen|carmen)'),
      ('Economia',       '(econom|inflaç|desemprego|emprego|salári|pib|imposto|tribut|juros?|selic|dólar|dolar|mercado financeiro|fiscal|orçament|orcament|reforma trib|gasolina|combustív|carestia|auxíli|bolsa famíli|arcabouço|arcabouco)'),
      ('Segurança Pública','(segurança pública|seguranca publica|violênci|polícia|policia|crime|porte de arma|narcotráfic|tráfic|homicíd|facç|milíci|pcc|cv|operação policial)'),
      ('Corrupção',      '(corrupç|propina|desvio|lava jato|peculato|escândal|cpmi|cpi|delaç|delac)'),
      ('Reforma Tributária','(reforma trib|reforma tributária|reforma tributaria|iva|cbs|ibs)'),
      ('Anistia/8 de Janeiro','(anistia|8 de janeiro|janeiro de 2023|golpe|golpist|invasão dos três poderes)'),
      ('Política Internacional','(brics|otan|onu|mercosul|maduro|trump|biden|putin|milei|guerra|ucrân|ucran|israel|gaza|hamas|palestin)'),
      ('Direitos & Sociedade','(direitos humanos|lgbt|lgbtq|racism|negros?|feminis|aborto|igualdade|minoria|indígen)'),
      ('Eleitorado Religioso','(igreja|cristã|cristao|evangéli|católic|pastor|padre|fé religiosa)'),
      ('Bolsonaro',      '(bolsonaro|carluxo|michelle|flavio bolsonaro|eduardo bolsonaro|jair bolsonaro)'),
      ('Lula/PT',        '(\mlula\M|\mpt\M|petist|lulist|janja|gleisi|haddad)')
  ),
  cur AS MATERIALIZED (
    SELECT si.comment_text, public.network_view_sentiment(si.sentiment_label) AS sent
    FROM public.social_interactions si
    WHERE si.collected_at >= v_since
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND public.nv_is_political_text(si.comment_text, v_candidate_name)
    ORDER BY si.collected_at DESC
    LIMIT v_limit
  ),
  prev AS MATERIALIZED (
    SELECT si.comment_text, public.network_view_sentiment(si.sentiment_label) AS sent
    FROM public.social_interactions si
    WHERE si.collected_at >= v_prev_since AND si.collected_at < v_since
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND public.nv_is_political_text(si.comment_text, v_candidate_name)
    ORDER BY si.collected_at DESC
    LIMIT v_limit
  ),
  topic_matches AS (
    SELECT td.theme, c.sent FROM cur c JOIN theme_dict td ON c.comment_text ~* td.pattern
  ),
  topic_prev AS (
    SELECT td.theme, count(*)::bigint AS prev_mentions
    FROM prev p JOIN theme_dict td ON p.comment_text ~* td.pattern GROUP BY td.theme
  ),
  topics AS (
    SELECT tm.theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent='positive')::bigint AS pos,
      count(*) FILTER (WHERE sent='negative')::bigint AS neg,
      count(*) FILTER (WHERE sent='neutral')::bigint AS neu,
      coalesce((SELECT prev_mentions FROM topic_prev tp WHERE tp.theme = tm.theme),0)::bigint AS prev_mentions
    FROM topic_matches tm GROUP BY tm.theme ORDER BY mentions DESC LIMIT 15
  ),
  explicit_tags AS (
    SELECT lower(m[1]) AS raw_tag, c.sent
    FROM cur c, regexp_matches(coalesce(c.comment_text,''), '#([[:alnum:]_áéíóúâêîôûãõç]{3,40})', 'g') AS m
  ),
  explicit_tags_prev AS (
    SELECT lower(m[1]) AS raw_tag
    FROM prev p, regexp_matches(coalesce(p.comment_text,''), '#([[:alnum:]_áéíóúâêîôûãõç]{3,40})', 'g') AS m
  ),
  tag_norm AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$',''), '_+$','') AS tag, sent
    FROM explicit_tags WHERE public.nv_is_valid_hashtag(raw_tag)
  ),
  tag_norm_prev AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$',''), '_+$','') AS tag
    FROM explicit_tags_prev WHERE public.nv_is_valid_hashtag(raw_tag)
  ),
  hashtags AS (
    SELECT '#'||tag AS tag,
      count(*)::bigint AS c,
      count(*) FILTER (WHERE sent='positive')::bigint AS pos,
      count(*) FILTER (WHERE sent='negative')::bigint AS neg,
      count(*) FILTER (WHERE sent='neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM tag_norm_prev tp WHERE tp.tag = tn.tag) AS prev_c
    FROM tag_norm tn
    WHERE public.nv_is_valid_hashtag(tag)
    GROUP BY tag ORDER BY c DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags),
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics)
  ), ((SELECT count(*) FROM cur)+(SELECT count(*) FROM prev))::bigint
  INTO v_data, v_records_read;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started))*1000)::integer;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records_read,v_duration,v_plan,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,false,v_duration,v_records_read,0,'success',NULL,v_plan);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'records_read',v_records_read));
EXCEPTION WHEN query_canceled THEN
  RETURN jsonb_build_object('ok',false,'message','A consulta de assuntos e hashtags excedeu o tempo limite.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.','diagnostics',jsonb_build_object('error',SQLERRM));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_content_metrics(uuid,text,integer) TO authenticated;

-- 5. Recriar top_posts com score (engajamento * 0.7 + recência * 0.3), max 30 dias, só políticos
DROP FUNCTION IF EXISTS public.network_view_top_posts(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.network_view_top_posts(
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
  -- Top posts: limita a no máximo 30 dias para evitar conteúdo antigo
  v_days integer := greatest(1, least(coalesce(p_days, 30), 30));
  v_network text := nullif(nullif(p_network, 'all'), '');
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 30)));
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_returned bigint := 0;
  v_candidate_name text;
  v_plan jsonb := jsonb_build_object('query','network_view_top_posts_v3','window_days_max',30,'score','0.7*eng_norm + 0.3*recency','filter','political');
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada. Entre novamente para carregar os dados.');
  END IF;

  IF p_candidate_id IS NOT NULL THEN
    SELECT full_name INTO v_candidate_name FROM public.candidates WHERE id = p_candidate_id;
  END IF;

  v_cache_key := md5(concat_ws('|','network_view_top_posts_v3', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));

  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started))*1000)::integer;
    PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,true,v_duration,0,1,'success',NULL,v_plan);
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'duration_ms',v_duration));
  END IF;

  WITH candidate_posts AS (
    SELECT si.id, si.social_network, si.comment_text, si.comment_author,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at, si.collected_at
    FROM public.social_interactions si
    WHERE si.collected_at >= v_since
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
      AND public.nv_is_political_text(si.comment_text, v_candidate_name)
    ORDER BY (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0)) DESC NULLS LAST, si.collected_at DESC
    LIMIT 200
  ),
  scored AS (
    SELECT cp.*,
      -- engajamento normalizado (0..1)
      CASE WHEN (SELECT max(eng) FROM candidate_posts) > 0
        THEN cp.eng::float / (SELECT max(eng) FROM candidate_posts)::float
        ELSE 0 END AS eng_norm,
      -- recência: 1 = agora, 0 = limite v_since
      greatest(0, 1 - extract(epoch FROM (now() - coalesce(cp.original_posted_at, cp.collected_at))) / greatest(1, extract(epoch FROM (now() - v_since)))) AS recency
    FROM candidate_posts cp
  ),
  ranked AS (
    SELECT *, (eng_norm * 0.7 + recency * 0.3) AS score FROM scored
    ORDER BY score DESC LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC), '[]'::jsonb)), count(*)::bigint
  INTO v_data, v_records_returned FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started))*1000)::integer;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,v_records_returned,v_duration,v_plan,now()+interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,source_rows=EXCLUDED.source_rows,duration_ms=EXCLUDED.duration_ms,plan=EXCLUDED.plan,expires_at=EXCLUDED.expires_at,updated_at=now();
  PERFORM public.log_network_view_query(v_uid,'top_posts',p_candidate_id,v_network,v_days,false,v_duration,v_records_returned,v_records_returned,'success',NULL,v_plan);
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'records_returned',v_records_returned));
EXCEPTION WHEN query_canceled THEN
  RETURN jsonb_build_object('ok',false,'message','A consulta de top posts excedeu o tempo limite.');
WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.','diagnostics',jsonb_build_object('error',SQLERRM));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

-- 6. Invalidar cache antigo para forçar recálculo
DELETE FROM public.network_view_cache;
