
CREATE TABLE IF NOT EXISTS public.daily_topic_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  theme text NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  positive_count bigint NOT NULL DEFAULT 0,
  negative_count bigint NOT NULL DEFAULT 0,
  neutral_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id, network, theme)
);
GRANT SELECT ON public.daily_topic_metrics TO authenticated;
GRANT ALL ON public.daily_topic_metrics TO service_role;
ALTER TABLE public.daily_topic_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own daily topic metrics" ON public.daily_topic_metrics;
CREATE POLICY "Users read own daily topic metrics" ON public.daily_topic_metrics
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_daily_topic_lookup ON public.daily_topic_metrics (user_id, candidate_id, network, metric_date DESC, mentions DESC);

CREATE TABLE IF NOT EXISTS public.daily_heatmap_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  dow smallint NOT NULL,
  hr smallint NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id, network, dow, hr)
);
GRANT SELECT ON public.daily_heatmap_metrics TO authenticated;
GRANT ALL ON public.daily_heatmap_metrics TO service_role;
ALTER TABLE public.daily_heatmap_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users read own daily heatmap metrics" ON public.daily_heatmap_metrics;
CREATE POLICY "Users read own daily heatmap metrics" ON public.daily_heatmap_metrics
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'::app_role));
CREATE INDEX IF NOT EXISTS idx_daily_heatmap_lookup ON public.daily_heatmap_metrics (user_id, candidate_id, network, metric_date DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_daily_topic_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_topic_metrics_updated_at BEFORE UPDATE ON public.daily_topic_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_daily_heatmap_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_heatmap_metrics_updated_at BEFORE UPDATE ON public.daily_heatmap_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_network_view_daily_metrics(p_since date DEFAULT (current_date - 2))
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
  SELECT si.id, si.user_id, si.candidate_id, si.social_network AS network,
    si.collected_at::date AS metric_date, si.collected_at, si.original_posted_at,
    si.comment_text, si.comment_author,
    COALESCE(si.likes_count,0)::bigint AS likes,
    COALESCE(si.replies_count,0)::bigint AS replies,
    COALESCE(si.shares_count,0)::bigint AS shares,
    public.network_view_sentiment(si.sentiment_label) AS sent,
    c.full_name AS candidate_name
  FROM public.social_interactions si
  JOIN public.candidates c ON c.id = si.candidate_id
  WHERE si.collected_at >= p_since::timestamptz
    AND si.user_id IS NOT NULL AND si.candidate_id IS NOT NULL
    AND si.social_network IS NOT NULL
    AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
    AND public.nv_is_political_text(si.comment_text, c.full_name);

  CREATE INDEX ON _nv_base (user_id, candidate_id, network, metric_date);

  DELETE FROM public.daily_candidate_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_candidate_metrics (metric_date,user_id,candidate_id,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL)
  FROM _nv_base GROUP BY 1,2,3;
  GET DIAGNOSTICS v_cand_rows = ROW_COUNT;

  DELETE FROM public.daily_network_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_network_metrics (metric_date,user_id,candidate_id,network,mentions,unique_authors,likes,replies,shares,engagement,positive_count,negative_count,neutral_count,unknown_count)
  SELECT metric_date,user_id,candidate_id,network, count(*)::bigint, count(DISTINCT comment_author)::bigint,
    sum(likes), sum(replies), sum(shares), sum(likes+replies+shares),
    count(*) FILTER (WHERE sent='positive'), count(*) FILTER (WHERE sent='negative'),
    count(*) FILTER (WHERE sent='neutral'), count(*) FILTER (WHERE sent IS NULL)
  FROM _nv_base GROUP BY 1,2,3,4;
  GET DIAGNOSTICS v_net_rows = ROW_COUNT;

  DELETE FROM public.daily_sentiment_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_sentiment_metrics (metric_date,user_id,candidate_id,network,sentiment,mentions,engagement)
  SELECT metric_date,user_id,candidate_id,network, coalesce(sent,'unknown'),
    count(*)::bigint, sum(likes+replies+shares)
  FROM _nv_base GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_sent_rows = ROW_COUNT;

  DELETE FROM public.daily_heatmap_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_heatmap_metrics (metric_date,user_id,candidate_id,network,dow,hr,mentions)
  SELECT metric_date,user_id,candidate_id,network,
    extract(dow FROM coalesce(original_posted_at, collected_at))::smallint,
    extract(hour FROM coalesce(original_posted_at, collected_at))::smallint,
    count(*)::bigint
  FROM _nv_base GROUP BY 1,2,3,4,5,6;
  GET DIAGNOSTICS v_heat_rows = ROW_COUNT;

  DELETE FROM public.daily_hashtag_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_hashtag_metrics (metric_date,user_id,candidate_id,network,tag,mentions,positive_count,negative_count,neutral_count)
  SELECT x.metric_date,x.user_id,x.candidate_id,x.network,x.tag,
    count(*)::bigint,
    count(*) FILTER (WHERE x.sent='positive')::bigint,
    count(*) FILTER (WHERE x.sent='negative')::bigint,
    count(*) FILTER (WHERE x.sent='neutral')::bigint
  FROM (
    SELECT b.metric_date,b.user_id,b.candidate_id,b.network,b.sent,
      '#' || regexp_replace(regexp_replace(lower(m[1]), '(brasil|br|2024|2025|2026|2027|2028|oficial)$',''), '_+$','') AS tag
    FROM _nv_base b, regexp_matches(coalesce(b.comment_text,''), '#([[:alnum:]_áéíóúâêîôûãõç]{3,40})', 'g') AS m
    WHERE public.nv_is_valid_hashtag(m[1])
  ) x
  WHERE public.nv_is_valid_hashtag(replace(x.tag,'#',''))
  GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_hash_rows = ROW_COUNT;

  DELETE FROM public.daily_topic_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_topic_metrics (metric_date,user_id,candidate_id,network,theme,mentions,positive_count,negative_count,neutral_count)
  WITH dict(theme,pattern) AS (VALUES
    ('Eleições','(eleiç|eleic|voto|urna|campanha|candidat|tse|coligaç|datafolha|quaest|ipec|atlas intel)'),
    ('Governo Federal','(governo federal|planalto|presidente|presidência|presidencia|ministério|ministerio|ministr|esplanada)'),
    ('Congresso','(câmara|camara|congresso|deputad|emenda parlamentar)'),
    ('Senado','(\msenado\M|senador|senadora|cpi|cpmi)'),
    ('STF','(stf|supremo|moraes|toffoli|fachin|barroso|gilmar|fux|aras|lewandowski|mendonça|nunes marques|cármen|carmen)'),
    ('Economia','(econom|inflaç|desemprego|emprego|salári|pib|imposto|tribut|juros?|selic|dólar|dolar|fiscal|orçament|orcament|gasolina|combustív|auxíli|bolsa famíli|arcabouço|arcabouco)'),
    ('Segurança Pública','(segurança pública|seguranca publica|violênci|polícia|policia|crime|porte de arma|narcotráfic|tráfic|homicíd|facç|milíci|pcc|cv)'),
    ('Corrupção','(corrupç|propina|desvio|lava jato|peculato|escândal|delaç|delac)'),
    ('Reforma Tributária','(reforma trib|iva|cbs|ibs)'),
    ('Anistia/8 de Janeiro','(anistia|8 de janeiro|janeiro de 2023|golpe|golpist)'),
    ('Política Internacional','(brics|otan|onu|mercosul|maduro|trump|biden|putin|milei|ucrân|ucran|israel|gaza|hamas|palestin)'),
    ('Direitos & Sociedade','(direitos humanos|lgbt|lgbtq|racism|negros?|feminis|aborto|igualdade|minoria|indígen)'),
    ('Bolsonaro','(bolsonaro|carluxo|michelle|flavio bolsonaro|eduardo bolsonaro|jair bolsonaro)'),
    ('Lula/PT','(\mlula\M|\mpt\M|petist|lulist|janja|gleisi|haddad)')
  )
  SELECT b.metric_date,b.user_id,b.candidate_id,b.network,d.theme,
    count(*)::bigint,
    count(*) FILTER (WHERE b.sent='positive')::bigint,
    count(*) FILTER (WHERE b.sent='negative')::bigint,
    count(*) FILTER (WHERE b.sent='neutral')::bigint
  FROM _nv_base b
  JOIN dict d ON b.comment_text ~* d.pattern
  GROUP BY 1,2,3,4,5;
  GET DIAGNOSTICS v_topic_rows = ROW_COUNT;

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
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_core_v4', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;
  WITH net AS (
    SELECT metric_date, network, mentions, unique_authors, likes, replies, shares, engagement,
      positive_count, negative_count, neutral_count, (metric_date >= v_since) AS is_current
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
      coalesce(sum(neutral_count) FILTER (WHERE is_current),0)::bigint AS neu,
      coalesce(sum(mentions) FILTER (WHERE NOT is_current),0)::bigint AS prev_total,
      coalesce(sum(positive_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_pos,
      coalesce(sum(negative_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_neg,
      coalesce(sum(neutral_count) FILTER (WHERE NOT is_current),0)::bigint AS prev_neu
    FROM net
  ),
  series AS (
    SELECT to_char(metric_date,'YYYY-MM-DD') AS day,
      sum(positive_count)::bigint AS p, sum(negative_count)::bigint AS n, sum(neutral_count)::bigint AS u
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
  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'core',v_data,0,v_duration,'{"source":"daily_aggregates"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_aggregates'));
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
  v_cache_key := md5(concat_ws('|','nv_content_v4', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
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
  ),
  t_prev AS (
    SELECT theme, sum(mentions)::bigint AS prev_mentions
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1
  ),
  topics AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM t_cur c LEFT JOIN t_prev p USING (theme) ORDER BY mentions DESC LIMIT 15
  ),
  h_cur AS (
    SELECT tag, sum(mentions)::bigint AS c,
      sum(positive_count)::bigint AS pos, sum(negative_count)::bigint AS neg, sum(neutral_count)::bigint AS neu
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1
  ),
  h_prev AS (
    SELECT tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR network = v_network)
    GROUP BY 1
  ),
  hashtags AS (
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
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,0,v_duration,'{"source":"daily_aggregates"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,'source','daily_aggregates'));
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
  v_days int := greatest(1, least(coalesce(p_days,30), 30));
  v_network text := nullif(nullif(p_network,'all'),'');
  v_since timestamptz := now() - make_interval(days => v_days);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
  v_candidate_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  IF p_candidate_id IS NOT NULL THEN SELECT full_name INTO v_candidate_name FROM public.candidates WHERE id = p_candidate_id; END IF;
  v_cache_key := md5(concat_ws('|','nv_top_v4', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;
  WITH cands AS (
    SELECT si.id, si.social_network, si.comment_text, si.comment_author,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes, COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at, si.collected_at
    FROM public.social_interactions si
    WHERE si.collected_at >= v_since
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0)) DESC NULLS LAST, si.collected_at DESC
    LIMIT 1000
  ),
  political AS (SELECT * FROM cands WHERE public.nv_is_political_text(comment_text, v_candidate_name)),
  scored AS (
    SELECT p.*,
      CASE WHEN (SELECT max(eng) FROM political) > 0 THEN p.eng::float / (SELECT max(eng) FROM political)::float ELSE 0 END AS eng_norm,
      greatest(0, 1 - extract(epoch FROM (now() - coalesce(p.original_posted_at, p.collected_at))) / greatest(1, extract(epoch FROM (now() - v_since)))) AS recency
    FROM political p
  ),
  ranked AS (SELECT *, (eng_norm*0.7 + recency*0.3) AS score FROM scored ORDER BY score DESC LIMIT 5)
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC),'[]'::jsonb))
  INTO v_data FROM ranked;
  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,0,v_duration,'{"source":"top1000_eng_index"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END; $$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid,text,integer) TO authenticated;

DELETE FROM public.network_view_cache;

DO $$ BEGIN PERFORM cron.unschedule('refresh-network-view-daily-metrics'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'refresh-network-view-daily-metrics',
  '*/15 * * * *',
  $cmd$ SELECT public.refresh_network_view_daily_metrics(current_date - 2); $cmd$
);
