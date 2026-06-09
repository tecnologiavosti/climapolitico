CREATE TABLE IF NOT EXISTS public.network_view_cache (
  cache_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  candidate_id uuid NULL,
  network text NULL,
  days integer NOT NULL,
  section text NOT NULL,
  result jsonb NOT NULL,
  source_rows bigint NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  hit_count bigint NOT NULL DEFAULT 0,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  last_hit_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.network_view_cache TO authenticated;
GRANT ALL ON public.network_view_cache TO service_role;
ALTER TABLE public.network_view_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own network view cache" ON public.network_view_cache;
CREATE POLICY "Users can read own network view cache" ON public.network_view_cache
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.network_view_query_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL,
  section text NOT NULL,
  candidate_id uuid NULL,
  network text NULL,
  days integer NULL,
  cache_hit boolean NOT NULL DEFAULT false,
  duration_ms integer NOT NULL DEFAULT 0,
  records_read bigint NOT NULL DEFAULT 0,
  records_returned bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'success',
  error_message text NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.network_view_query_logs TO authenticated;
GRANT ALL ON public.network_view_query_logs TO service_role;
ALTER TABLE public.network_view_query_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own network view logs" ON public.network_view_query_logs;
CREATE POLICY "Users can read own network view logs" ON public.network_view_query_logs
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.daily_candidate_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  unique_authors bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  replies bigint NOT NULL DEFAULT 0,
  shares bigint NOT NULL DEFAULT 0,
  engagement bigint NOT NULL DEFAULT 0,
  positive_count bigint NOT NULL DEFAULT 0,
  negative_count bigint NOT NULL DEFAULT 0,
  neutral_count bigint NOT NULL DEFAULT 0,
  unknown_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id)
);
GRANT SELECT ON public.daily_candidate_metrics TO authenticated;
GRANT ALL ON public.daily_candidate_metrics TO service_role;
ALTER TABLE public.daily_candidate_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own daily candidate metrics" ON public.daily_candidate_metrics;
CREATE POLICY "Users can read own daily candidate metrics" ON public.daily_candidate_metrics
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.daily_network_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  unique_authors bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  replies bigint NOT NULL DEFAULT 0,
  shares bigint NOT NULL DEFAULT 0,
  engagement bigint NOT NULL DEFAULT 0,
  positive_count bigint NOT NULL DEFAULT 0,
  negative_count bigint NOT NULL DEFAULT 0,
  neutral_count bigint NOT NULL DEFAULT 0,
  unknown_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id, network)
);
GRANT SELECT ON public.daily_network_metrics TO authenticated;
GRANT ALL ON public.daily_network_metrics TO service_role;
ALTER TABLE public.daily_network_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own daily network metrics" ON public.daily_network_metrics;
CREATE POLICY "Users can read own daily network metrics" ON public.daily_network_metrics
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.daily_sentiment_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  sentiment text NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  engagement bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id, network, sentiment)
);
GRANT SELECT ON public.daily_sentiment_metrics TO authenticated;
GRANT ALL ON public.daily_sentiment_metrics TO service_role;
ALTER TABLE public.daily_sentiment_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own daily sentiment metrics" ON public.daily_sentiment_metrics;
CREATE POLICY "Users can read own daily sentiment metrics" ON public.daily_sentiment_metrics
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.daily_hashtag_metrics (
  metric_date date NOT NULL,
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  network text NOT NULL,
  tag text NOT NULL,
  mentions bigint NOT NULL DEFAULT 0,
  positive_count bigint NOT NULL DEFAULT 0,
  negative_count bigint NOT NULL DEFAULT 0,
  neutral_count bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (metric_date, user_id, candidate_id, network, tag)
);
GRANT SELECT ON public.daily_hashtag_metrics TO authenticated;
GRANT ALL ON public.daily_hashtag_metrics TO service_role;
ALTER TABLE public.daily_hashtag_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can read own daily hashtag metrics" ON public.daily_hashtag_metrics;
CREATE POLICY "Users can read own daily hashtag metrics" ON public.daily_hashtag_metrics
FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_network_view_cache_updated_at') THEN
    CREATE TRIGGER update_network_view_cache_updated_at BEFORE UPDATE ON public.network_view_cache FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_network_view_query_logs_updated_at') THEN
    CREATE TRIGGER update_network_view_query_logs_updated_at BEFORE UPDATE ON public.network_view_query_logs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_daily_candidate_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_candidate_metrics_updated_at BEFORE UPDATE ON public.daily_candidate_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_daily_network_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_network_metrics_updated_at BEFORE UPDATE ON public.daily_network_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_daily_sentiment_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_sentiment_metrics_updated_at BEFORE UPDATE ON public.daily_sentiment_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_daily_hashtag_metrics_updated_at') THEN
    CREATE TRIGGER update_daily_hashtag_metrics_updated_at BEFORE UPDATE ON public.daily_hashtag_metrics FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_network_view_cache_lookup ON public.network_view_cache (user_id, section, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_network_view_logs_lookup ON public.network_view_query_logs (user_id, created_at DESC, section);
CREATE INDEX IF NOT EXISTS idx_daily_candidate_metrics_lookup ON public.daily_candidate_metrics (user_id, candidate_id, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_network_metrics_lookup ON public.daily_network_metrics (user_id, candidate_id, network, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sentiment_metrics_lookup ON public.daily_sentiment_metrics (user_id, candidate_id, network, sentiment, metric_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_hashtag_metrics_lookup ON public.daily_hashtag_metrics (user_id, candidate_id, network, metric_date DESC, mentions DESC);

CREATE INDEX IF NOT EXISTS idx_si_nv_collected_at_desc ON public.social_interactions (collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_collected ON public.social_interactions (user_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_collected ON public.social_interactions (user_id, candidate_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_network_collected ON public.social_interactions (user_id, social_network, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_network_collected ON public.social_interactions (user_id, candidate_id, social_network, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_sentiment_collected ON public.social_interactions (user_id, sentiment_label, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_created_at ON public.social_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_published_at ON public.social_interactions (user_id, original_posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_si_nv_user_source_collected ON public.social_interactions (user_id, platform, collected_at DESC) WHERE platform IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_si_nv_user_engagement ON public.social_interactions (user_id, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC, collected_at DESC) WHERE comment_text IS NOT NULL AND length(comment_text) > 0;
CREATE INDEX IF NOT EXISTS idx_si_nv_user_network_engagement ON public.social_interactions (user_id, social_network, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC, collected_at DESC) WHERE comment_text IS NOT NULL AND length(comment_text) > 0;
CREATE INDEX IF NOT EXISTS idx_si_nv_user_candidate_engagement ON public.social_interactions (user_id, candidate_id, ((COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0))) DESC, collected_at DESC) WHERE comment_text IS NOT NULL AND length(comment_text) > 0;

CREATE OR REPLACE FUNCTION public.network_view_sentiment(_label text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(_label, ''))
    WHEN 'positivo' THEN 'positive'
    WHEN 'positive' THEN 'positive'
    WHEN 'negativo' THEN 'negative'
    WHEN 'negative' THEN 'negative'
    WHEN 'neutro' THEN 'neutral'
    WHEN 'neutral' THEN 'neutral'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.log_network_view_query(
  p_user_id uuid,
  p_section text,
  p_candidate_id uuid,
  p_network text,
  p_days integer,
  p_cache_hit boolean,
  p_duration_ms integer,
  p_records_read bigint,
  p_records_returned bigint,
  p_status text,
  p_error_message text DEFAULT NULL,
  p_plan jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.network_view_query_logs (
    user_id, section, candidate_id, network, days, cache_hit,
    duration_ms, records_read, records_returned, status, error_message, plan
  ) VALUES (
    p_user_id, p_section, p_candidate_id, p_network, p_days, p_cache_hit,
    p_duration_ms, coalesce(p_records_read, 0), coalesce(p_records_returned, 0), p_status, p_error_message, coalesce(p_plan, '{}'::jsonb)
  );
  RAISE LOG '[NetworkView] section=% user=% candidate=% network=% days=% cache_hit=% duration_ms=% read=% returned=% status=% error=% plan=%',
    p_section, p_user_id, p_candidate_id, p_network, p_days, p_cache_hit, p_duration_ms, coalesce(p_records_read, 0), coalesce(p_records_returned, 0), p_status, p_error_message, coalesce(p_plan, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[NetworkView] failed to persist diagnostic log: %', SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.log_network_view_query(uuid, text, uuid, text, integer, boolean, integer, bigint, bigint, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_network_view_query(uuid, text, uuid, text, integer, boolean, integer, bigint, bigint, text, text, jsonb) TO authenticated, service_role;

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
  v_plan jsonb := jsonb_build_object(
    'query', 'network_view_core_metrics',
    'strategy', 'indexed aggregate split from hashtags/topics/top_posts',
    'heavy_operations_removed', jsonb_build_array('regex topics', 'regexp hashtag extraction', 'top engagement sort'),
    'indexes', jsonb_build_array('idx_si_nv_user_collected', 'idx_si_nv_user_candidate_collected', 'idx_si_nv_user_network_collected', 'idx_si_nv_user_candidate_network_collected', 'idx_si_nv_user_sentiment_collected')
  );
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada. Entre novamente para carregar os dados.', 'diagnostics', jsonb_build_object('status', 'not_authenticated'));
  END IF;

  v_cache_key := md5(concat_ws('|', 'network_view_core', v_uid::text, coalesce(p_candidate_id::text, 'all'), coalesce(v_network, 'all'), v_days::text));

  SELECT result INTO v_cached
  FROM public.network_view_cache
  WHERE cache_key = v_cache_key AND expires_at > now();

  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'core', p_candidate_id, v_network, v_days, true, v_duration, 0, 1, 'success', NULL, v_plan || jsonb_build_object('cache', 'hit'));
    RETURN jsonb_build_object('ok', true, 'data', v_cached, 'diagnostics', jsonb_build_object('cache_hit', true, 'duration_ms', v_duration, 'records_read', 0, 'records_returned', 1, 'plan', v_plan));
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      si.id,
      si.social_network,
      si.comment_author,
      COALESCE(si.likes_count, 0)::bigint AS likes,
      COALESCE(si.replies_count, 0)::bigint AS replies,
      COALESCE(si.shares_count, 0)::bigint AS shares,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      si.collected_at,
      si.original_posted_at,
      (si.collected_at >= v_since) AS is_current
    FROM public.social_interactions si
    WHERE si.collected_at >= v_prev_since
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ),
  row_count AS (
    SELECT count(*)::bigint AS records_read FROM filtered
  ),
  kpis AS (
    SELECT
      count(*) FILTER (WHERE is_current)::bigint AS total,
      count(DISTINCT comment_author) FILTER (WHERE is_current AND comment_author IS NOT NULL)::bigint AS authors,
      coalesce(sum(likes + replies + shares) FILTER (WHERE is_current), 0)::bigint AS engagement,
      coalesce(sum(likes) FILTER (WHERE is_current), 0)::bigint AS likes,
      coalesce(sum(replies) FILTER (WHERE is_current), 0)::bigint AS replies,
      coalesce(sum(shares) FILTER (WHERE is_current), 0)::bigint AS shares,
      count(*) FILTER (WHERE is_current AND sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE is_current AND sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE is_current AND sent = 'neutral')::bigint AS neu,
      count(*) FILTER (WHERE NOT is_current)::bigint AS prev_total,
      count(*) FILTER (WHERE NOT is_current AND sent = 'positive')::bigint AS prev_pos,
      count(*) FILTER (WHERE NOT is_current AND sent = 'negative')::bigint AS prev_neg,
      count(*) FILTER (WHERE NOT is_current AND sent = 'neutral')::bigint AS prev_neu
    FROM filtered
  ),
  series AS (
    SELECT to_char(date_trunc('day', collected_at), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS u
    FROM filtered
    WHERE is_current
    GROUP BY 1
  ),
  by_net AS (
    SELECT social_network AS network,
      count(*)::bigint AS mentions,
      coalesce(sum(likes), 0)::bigint AS likes,
      coalesce(sum(replies), 0)::bigint AS replies,
      coalesce(sum(shares), 0)::bigint AS shares,
      coalesce(sum(likes + replies + shares), 0)::bigint AS engagement
    FROM filtered
    WHERE is_current
    GROUP BY 1
  ),
  heat AS (
    SELECT extract(dow FROM coalesce(original_posted_at, collected_at))::int AS dow,
      extract(hour FROM coalesce(original_posted_at, collected_at))::int AS hr,
      count(*)::bigint AS c
    FROM filtered
    WHERE is_current
    GROUP BY 1, 2
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT to_jsonb(kpis.*) FROM kpis),
    'series', (SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day), '[]'::jsonb) FROM series),
    'by_network', (SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY engagement DESC), '[]'::jsonb) FROM by_net),
    'heatmap', (SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow, hr), '[]'::jsonb) FROM heat)
  ),
  (SELECT records_read FROM row_count)
  INTO v_data, v_records_read;

  v_records_returned := 1
    + coalesce(jsonb_array_length(v_data->'series'), 0)
    + coalesce(jsonb_array_length(v_data->'by_network'), 0)
    + coalesce(jsonb_array_length(v_data->'heatmap'), 0);
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, plan, expires_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, v_network, v_days, 'core', v_data, v_records_read, v_duration, v_plan, now() + interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET
    result = EXCLUDED.result,
    source_rows = EXCLUDED.source_rows,
    duration_ms = EXCLUDED.duration_ms,
    plan = EXCLUDED.plan,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

  PERFORM public.log_network_view_query(v_uid, 'core', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'success', NULL, v_plan);
  RETURN jsonb_build_object('ok', true, 'data', v_data, 'diagnostics', jsonb_build_object('cache_hit', false, 'duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'plan', v_plan));
EXCEPTION
  WHEN query_canceled THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'core', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'timeout', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'A consulta de métricas gerais excedeu o tempo limite.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
  WHEN OTHERS THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'core', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'error', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar as métricas gerais.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid, text, integer) TO authenticated;

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
  v_limit integer := CASE WHEN coalesce(p_days, 30) > 365 THEN 30000 ELSE 15000 END;
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
  v_plan jsonb := jsonb_build_object(
    'query', 'network_view_content_metrics',
    'strategy', 'bounded latest-sample text analysis separated from core metrics',
    'sample_limit_per_period', CASE WHEN coalesce(p_days, 30) > 365 THEN 30000 ELSE 15000 END,
    'expensive_operations', jsonb_build_array('regex topic matching', 'regexp hashtag extraction'),
    'indexes', jsonb_build_array('idx_si_nv_user_collected', 'idx_si_nv_user_candidate_collected', 'idx_si_nv_user_network_collected')
  );
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada. Entre novamente para carregar os dados.', 'diagnostics', jsonb_build_object('status', 'not_authenticated'));
  END IF;

  v_cache_key := md5(concat_ws('|', 'network_view_content', v_uid::text, coalesce(p_candidate_id::text, 'all'), coalesce(v_network, 'all'), v_days::text));

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
      ('Economia',      '(econom|inflaç|desemprego|emprego|salári|pib|imposto|tribut|juros?|selic|dólar|dolar|mercado|fiscal|orçament|reforma trib|gasolina|combustív|preço|carestia|pobreza|renda|bolsa famíli|auxíli)'),
      ('Segurança',     '(segurança|violênci|polícia|policia|crime|bandid|armas?|porte de arma|narcotráfic|tráfic|homicíd|assalt|roubo|facç|milíci|pcc|cv)'),
      ('Educação',      '(educaç|escola|universidad|professor|aluno|enem|fies|prouni|creche|analfabet|ensino)'),
      ('Saúde',         '(saúde|sus|hospital|médic|vacin|doenç|pandemi|covid|posto de saúde|farmáci|remédi|dengue)'),
      ('Eleições',      '(eleiç|voto|candidat|urna|campanha|partido|tse|coligaç|debate|pesquisa eleitoral|datafolha|quaest|ipec)'),
      ('Corrupção',     '(corrupç|propina|desvio|lava jato|fraud|peculato|escândal|cpmi|cpi)'),
      ('Meio Ambiente', '(meio ambient|amazôni|amazonia|desmatament|climátic|sustentab|queimad|indígen|cop[0-9]+)'),
      ('Direitos',      '(direitos humanos|lgbt|lgbtq|racism|negros?|mulher|feminis|aborto|igualdade|minoria)'),
      ('Religião',      '(igreja|cristã|cristao|evangéli|católic|deus|pastor|padre|fé|religi)'),
      ('Infraestrutura','(infraestrutur|obras|estrada|rodovi|ponte|saneament|transport|metrô|metro|ônibus|onibus|mobilidade)'),
      ('Tecnologia',    '(tecnolog|inteligência artificial|ia\y|inovaç|startup|digital|internet|5g|cibern)'),
      ('Trabalho',      '(trabalh|clt|carteira assinada|sindicat|greve|terceirizaç|reforma trabal)'),
      ('Agronegócio',   '(agro|agronegóci|fazend|soja|pecuári|produtor rural|mst|reforma agrári)')
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
  row_count AS (
    SELECT ((SELECT count(*) FROM cur) + (SELECT count(*) FROM prev))::bigint AS records_read
  ),
  topic_matches AS (
    SELECT td.theme, c.sent
    FROM cur c
    JOIN theme_dict td ON c.comment_text ~* td.pattern
  ),
  topic_prev AS (
    SELECT td.theme, count(*)::bigint AS prev_mentions
    FROM prev p
    JOIN theme_dict td ON p.comment_text ~* td.pattern
    GROUP BY td.theme
  ),
  topics AS (
    SELECT tm.theme,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      coalesce((SELECT prev_mentions FROM topic_prev tp WHERE tp.theme = tm.theme), 0)::bigint AS prev_mentions
    FROM topic_matches tm
    GROUP BY tm.theme
    ORDER BY mentions DESC
    LIMIT 20
  ),
  explicit_tags AS (
    SELECT lower(m[1]) AS raw_tag, c.sent
    FROM cur c, regexp_matches(coalesce(c.comment_text, ''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  explicit_tags_prev AS (
    SELECT lower(m[1]) AS raw_tag
    FROM prev p, regexp_matches(coalesce(p.comment_text, ''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  tag_norm AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag, sent
    FROM explicit_tags
  ),
  tag_norm_prev AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag
    FROM explicit_tags_prev
  ),
  explicit_grouped AS (
    SELECT tag,
      count(*)::bigint AS mentions,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM tag_norm_prev tp WHERE tp.tag = tn.tag) AS prev_mentions
    FROM tag_norm tn
    WHERE length(tag) >= 2
    GROUP BY tag
  ),
  implicit_grouped AS (
    SELECT lower(theme) AS tag, mentions, pos, neg, neu, prev_mentions
    FROM topics
  ),
  hashtags AS (
    SELECT '#' || tag AS tag,
      sum(mentions)::bigint AS c,
      sum(pos)::bigint AS pos,
      sum(neg)::bigint AS neg,
      sum(neu)::bigint AS neu,
      sum(prev_mentions)::bigint AS prev_c
    FROM (
      SELECT tag, mentions, pos, neg, neu, prev_mentions FROM explicit_grouped
      UNION ALL
      SELECT tag, mentions, pos, neg, neu, prev_mentions FROM implicit_grouped
    ) h
    GROUP BY tag
    ORDER BY c DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'hashtags', (SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC), '[]'::jsonb) FROM hashtags),
    'topics', (SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC), '[]'::jsonb) FROM topics)
  ),
  (SELECT records_read FROM row_count)
  INTO v_data, v_records_read;

  v_records_returned := coalesce(jsonb_array_length(v_data->'hashtags'), 0) + coalesce(jsonb_array_length(v_data->'topics'), 0);
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, plan, expires_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, v_network, v_days, 'content', v_data, v_records_read, v_duration, v_plan, now() + interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET
    result = EXCLUDED.result,
    source_rows = EXCLUDED.source_rows,
    duration_ms = EXCLUDED.duration_ms,
    plan = EXCLUDED.plan,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

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
  v_days integer := greatest(1, least(coalesce(p_days, 30), 3650));
  v_network text := nullif(nullif(p_network, 'all'), '');
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 3650)));
  v_started timestamptz := clock_timestamp();
  v_duration integer := 0;
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_records_read bigint := 0;
  v_records_returned bigint := 0;
  v_plan jsonb := jsonb_build_object(
    'query', 'network_view_top_posts',
    'strategy', 'indexed engagement sort isolated from other dashboard sections',
    'indexes', jsonb_build_array('idx_si_nv_user_engagement', 'idx_si_nv_user_network_engagement', 'idx_si_nv_user_candidate_engagement')
  );
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Sessão expirada. Entre novamente para carregar os dados.', 'diagnostics', jsonb_build_object('status', 'not_authenticated'));
  END IF;

  v_cache_key := md5(concat_ws('|', 'network_view_top_posts', v_uid::text, coalesce(p_candidate_id::text, 'all'), coalesce(v_network, 'all'), v_days::text));

  SELECT result INTO v_cached
  FROM public.network_view_cache
  WHERE cache_key = v_cache_key AND expires_at > now();

  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'top_posts', p_candidate_id, v_network, v_days, true, v_duration, 0, 1, 'success', NULL, v_plan || jsonb_build_object('cache', 'hit'));
    RETURN jsonb_build_object('ok', true, 'data', v_cached, 'diagnostics', jsonb_build_object('cache_hit', true, 'duration_ms', v_duration, 'records_read', 0, 'records_returned', 1, 'plan', v_plan));
  END IF;

  WITH posts AS (
    SELECT si.id,
      si.social_network,
      si.comment_text,
      si.comment_author,
      public.network_view_sentiment(si.sentiment_label) AS sent,
      (COALESCE(si.likes_count, 0) + COALESCE(si.replies_count, 0) + COALESCE(si.shares_count, 0))::bigint AS eng,
      COALESCE(si.likes_count, 0)::bigint AS likes,
      COALESCE(si.replies_count, 0)::bigint AS replies,
      COALESCE(si.shares_count, 0)::bigint AS shares,
      si.original_posted_at,
      si.collected_at
    FROM public.social_interactions si
    WHERE si.collected_at >= v_since
      AND si.comment_text IS NOT NULL
      AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR si.social_network = v_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY (COALESCE(si.likes_count, 0) + COALESCE(si.replies_count, 0) + COALESCE(si.shares_count, 0)) DESC NULLS LAST, si.collected_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(posts.*) ORDER BY eng DESC), '[]'::jsonb)), count(*)::bigint
  INTO v_data, v_records_returned
  FROM posts;

  v_records_read := v_records_returned;
  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;

  INSERT INTO public.network_view_cache (cache_key, user_id, candidate_id, network, days, section, result, source_rows, duration_ms, plan, expires_at)
  VALUES (v_cache_key, v_uid, p_candidate_id, v_network, v_days, 'top_posts', v_data, v_records_read, v_duration, v_plan, now() + interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET
    result = EXCLUDED.result,
    source_rows = EXCLUDED.source_rows,
    duration_ms = EXCLUDED.duration_ms,
    plan = EXCLUDED.plan,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

  PERFORM public.log_network_view_query(v_uid, 'top_posts', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'success', NULL, v_plan);
  RETURN jsonb_build_object('ok', true, 'data', v_data, 'diagnostics', jsonb_build_object('cache_hit', false, 'duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'plan', v_plan));
EXCEPTION
  WHEN query_canceled THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'top_posts', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'timeout', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'A consulta de top posts excedeu o tempo limite.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
  WHEN OTHERS THEN
    v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::integer;
    PERFORM public.log_network_view_query(v_uid, 'top_posts', p_candidate_id, v_network, v_days, false, v_duration, v_records_read, v_records_returned, 'error', SQLERRM, v_plan);
    RETURN jsonb_build_object('ok', false, 'message', 'Não foi possível carregar os top posts.', 'diagnostics', jsonb_build_object('duration_ms', v_duration, 'records_read', v_records_read, 'records_returned', v_records_returned, 'error_code', SQLSTATE, 'plan', v_plan));
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_top_posts(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.network_view_aggregate(
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
  v_core jsonb;
  v_content jsonb;
  v_top jsonb;
BEGIN
  v_core := public.network_view_core_metrics(p_candidate_id, p_network, p_days);
  v_content := public.network_view_content_metrics(p_candidate_id, p_network, p_days);
  v_top := public.network_view_top_posts(p_candidate_id, p_network, p_days);

  RETURN jsonb_build_object(
    'kpis', coalesce(v_core #> '{data,kpis}', '{}'::jsonb),
    'series', coalesce(v_core #> '{data,series}', '[]'::jsonb),
    'by_network', coalesce(v_core #> '{data,by_network}', '[]'::jsonb),
    'heatmap', coalesce(v_core #> '{data,heatmap}', '[]'::jsonb),
    'hashtags', coalesce(v_content #> '{data,hashtags}', '[]'::jsonb),
    'topics', coalesce(v_content #> '{data,topics}', '[]'::jsonb),
    'top_posts', coalesce(v_top #> '{data,top_posts}', '[]'::jsonb),
    'diagnostics', jsonb_build_object('core', v_core->'diagnostics', 'content', v_content->'diagnostics', 'top_posts', v_top->'diagnostics'),
    'errors', jsonb_strip_nulls(jsonb_build_object(
      'core', CASE WHEN coalesce((v_core->>'ok')::boolean, false) THEN NULL ELSE v_core->>'message' END,
      'content', CASE WHEN coalesce((v_content->>'ok')::boolean, false) THEN NULL ELSE v_content->>'message' END,
      'top_posts', CASE WHEN coalesce((v_top->>'ok')::boolean, false) THEN NULL ELSE v_top->>'message' END
    ))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.network_view_aggregate(uuid, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.refresh_network_view_daily_metrics(p_since date DEFAULT (current_date - 2))
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_rows integer := 0;
  v_network_rows integer := 0;
  v_sentiment_rows integer := 0;
  v_hashtag_rows integer := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Apenas administradores podem atualizar métricas agregadas.';
  END IF;

  DELETE FROM public.daily_candidate_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_candidate_metrics (
    metric_date, user_id, candidate_id, mentions, unique_authors, likes, replies, shares, engagement,
    positive_count, negative_count, neutral_count, unknown_count
  )
  SELECT
    si.collected_at::date,
    si.user_id,
    si.candidate_id,
    count(*)::bigint,
    count(DISTINCT si.comment_author)::bigint,
    coalesce(sum(COALESCE(si.likes_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.replies_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.shares_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.likes_count, 0) + COALESCE(si.replies_count, 0) + COALESCE(si.shares_count, 0)), 0)::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'positive')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'negative')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'neutral')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) IS NULL)::bigint
  FROM public.social_interactions si
  WHERE si.collected_at >= p_since::timestamptz
    AND si.user_id IS NOT NULL
    AND si.candidate_id IS NOT NULL
    AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  GROUP BY 1, 2, 3;
  GET DIAGNOSTICS v_candidate_rows = ROW_COUNT;

  DELETE FROM public.daily_network_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_network_metrics (
    metric_date, user_id, candidate_id, network, mentions, unique_authors, likes, replies, shares, engagement,
    positive_count, negative_count, neutral_count, unknown_count
  )
  SELECT
    si.collected_at::date,
    si.user_id,
    si.candidate_id,
    si.social_network,
    count(*)::bigint,
    count(DISTINCT si.comment_author)::bigint,
    coalesce(sum(COALESCE(si.likes_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.replies_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.shares_count, 0)), 0)::bigint,
    coalesce(sum(COALESCE(si.likes_count, 0) + COALESCE(si.replies_count, 0) + COALESCE(si.shares_count, 0)), 0)::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'positive')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'negative')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) = 'neutral')::bigint,
    count(*) FILTER (WHERE public.network_view_sentiment(si.sentiment_label) IS NULL)::bigint
  FROM public.social_interactions si
  WHERE si.collected_at >= p_since::timestamptz
    AND si.user_id IS NOT NULL
    AND si.candidate_id IS NOT NULL
    AND si.social_network IS NOT NULL
    AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  GROUP BY 1, 2, 3, 4;
  GET DIAGNOSTICS v_network_rows = ROW_COUNT;

  DELETE FROM public.daily_sentiment_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_sentiment_metrics (metric_date, user_id, candidate_id, network, sentiment, mentions, engagement)
  SELECT
    si.collected_at::date,
    si.user_id,
    si.candidate_id,
    si.social_network,
    coalesce(public.network_view_sentiment(si.sentiment_label), 'unknown') AS sentiment,
    count(*)::bigint,
    coalesce(sum(COALESCE(si.likes_count, 0) + COALESCE(si.replies_count, 0) + COALESCE(si.shares_count, 0)), 0)::bigint
  FROM public.social_interactions si
  WHERE si.collected_at >= p_since::timestamptz
    AND si.user_id IS NOT NULL
    AND si.candidate_id IS NOT NULL
    AND si.social_network IS NOT NULL
    AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  GROUP BY 1, 2, 3, 4, 5;
  GET DIAGNOSTICS v_sentiment_rows = ROW_COUNT;

  DELETE FROM public.daily_hashtag_metrics WHERE metric_date >= p_since;
  INSERT INTO public.daily_hashtag_metrics (metric_date, user_id, candidate_id, network, tag, mentions, positive_count, negative_count, neutral_count)
  SELECT
    x.metric_date,
    x.user_id,
    x.candidate_id,
    x.network,
    x.tag,
    count(*)::bigint,
    count(*) FILTER (WHERE x.sent = 'positive')::bigint,
    count(*) FILTER (WHERE x.sent = 'negative')::bigint,
    count(*) FILTER (WHERE x.sent = 'neutral')::bigint
  FROM (
    SELECT
      si.collected_at::date AS metric_date,
      si.user_id,
      si.candidate_id,
      si.social_network AS network,
      '#' || regexp_replace(regexp_replace(lower(m[1]), '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag,
      public.network_view_sentiment(si.sentiment_label) AS sent
    FROM public.social_interactions si,
      regexp_matches(coalesce(si.comment_text, ''), '#([[:alnum:]_]{2,})', 'g') AS m
    WHERE si.collected_at >= p_since::timestamptz
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND si.social_network IS NOT NULL
      AND si.comment_text IS NOT NULL
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ) x
  WHERE length(x.tag) >= 3
  GROUP BY 1, 2, 3, 4, 5;
  GET DIAGNOSTICS v_hashtag_rows = ROW_COUNT;

  RETURN jsonb_build_object(
    'candidate_rows', v_candidate_rows,
    'network_rows', v_network_rows,
    'sentiment_rows', v_sentiment_rows,
    'hashtag_rows', v_hashtag_rows,
    'since', p_since
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.refresh_network_view_daily_metrics(date) TO authenticated, service_role;

SELECT cron.schedule('refresh-network-view-daily-metrics', '*/5 * * * *', $$ SELECT public.refresh_network_view_daily_metrics(current_date - 2); $$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-network-view-daily-metrics');

ANALYZE public.social_interactions;