
-- =========================================================
-- C1 + C2: network_view_content_metrics direto da SSOT com dedup
-- =========================================================
CREATE OR REPLACE FUNCTION public.network_view_content_metrics(
  p_candidate_id uuid DEFAULT NULL::uuid,
  p_network text DEFAULT NULL::text,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL
                         THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := now() - (v_days || ' days')::interval;
  v_prev_since timestamptz := now() - ((v_days * 2) || ' days')::interval;
  v_started timestamptz := clock_timestamp();
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_duration int := 0;
  v_records bigint := 0;
  v_np_regex text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_content_ssot_v3', v_uid::text,
    coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));

  SELECT result INTO v_cached FROM public.network_view_cache
   WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache
       SET hit_count = hit_count + 1, last_hit_at = now()
     WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,
      'diagnostics',jsonb_build_object('cache_hit',true,'source','social_interactions'));
  END IF;

  BEGIN
    v_np_regex := public.nv_non_political_regex();
  EXCEPTION WHEN OTHERS THEN
    v_np_regex := '(__never_match__)';
  END;

  WITH base AS (
    SELECT
      si.id,
      COALESCE(si.post_url, si.external_id, si.post_id, si.id::text) AS post_key,
      lower(coalesce(si.comment_text,''))                            AS txt,
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS ts
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND si.comment_text IS NOT NULL
      AND length(si.comment_text) > 0
      AND lower(coalesce(si.social_network,'')) = ANY(public.nv_visible_networks())
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_prev_since
      AND COALESCE(si.is_political_content, true) = true
      AND COALESCE(si.political_relevance_score, 5) >= 5
  ),
  themed AS (
    SELECT post_key, ts, CASE
      WHEN txt ~ '(econom|inflaç|emprego|salári|renda|imposto|tribut|preço|juros?|pib|custo de vida)' THEN 'economia'
      WHEN txt ~ '(segurança|crime|violência|polícia|tráfic|assalt|homicíd|facç|milíci)' THEN 'segurança'
      WHEN txt ~ '(saúde|hospital|sus|médic|vacin|remédi|doenç)' THEN 'saúde'
      WHEN txt ~ '(educaç|escola|professor|aluno|ensino|universidad|enem|creche)' THEN 'educação'
      WHEN txt ~ '(corrupç|propina|desvio|fraud|rachadinha|lava jato)' THEN 'corrupção'
      WHEN txt ~ '(eleiç|voto|votar|urna|campanha|candidat|presidente|governador|prefeito|senador|deputado)' THEN 'eleições'
      WHEN txt ~ '(obra|estrada|transport|ônibus|metrô|sanea|moradia|habit)' THEN 'infraestrutura'
      WHEN txt ~ '(bolsa famíli|auxíli|benefíci|pobreza|fome|cadúnico)' THEN 'programas sociais'
      WHEN txt ~ '(meio ambient|amazôni|clima|desmatament|queimad|enchent)' THEN 'meio ambiente'
      ELSE NULL END AS theme
    FROM base
    WHERE txt !~ v_np_regex
  ),
  topics_cur AS (
    SELECT theme,
           count(*)::bigint                 AS raw_mentions,
           count(DISTINCT post_key)::bigint AS mentions
    FROM themed
    WHERE theme IS NOT NULL AND ts >= v_since
    GROUP BY theme
  ),
  topics_prev AS (
    SELECT theme, count(DISTINCT post_key)::bigint AS prev_mentions
    FROM themed
    WHERE theme IS NOT NULL AND ts >= v_prev_since AND ts < v_since
    GROUP BY theme
  ),
  topics AS (
    SELECT c.theme, c.mentions, c.raw_mentions,
           COALESCE(p.prev_mentions, 0)::bigint AS prev_mentions,
           CASE WHEN c.mentions > 0
                THEN round(((c.raw_mentions - c.mentions)::numeric / c.mentions) * 100, 2)
                ELSE 0 END AS inflation_pct
    FROM topics_cur c LEFT JOIN topics_prev p USING (theme)
    ORDER BY c.mentions DESC
    LIMIT 20
  ),
  hashtags_raw AS (
    SELECT
      public.nv_normalize_hashtag((regexp_matches(b.txt, '#([\w\u00C0-\u017F]{2,40})', 'g'))[1]) AS norm_tag,
      b.post_key,
      b.ts
    FROM base b
  ),
  hashtags_filtered AS (
    SELECT norm_tag, post_key, ts
    FROM hashtags_raw
    WHERE norm_tag IS NOT NULL
      AND public.nv_is_valid_hashtag(norm_tag)
  ),
  hashtags_cur AS (
    SELECT public.nv_hashtag_display(norm_tag) AS tag,
           count(*)::bigint                    AS raw_c,
           count(DISTINCT post_key)::bigint    AS c
    FROM hashtags_filtered
    WHERE ts >= v_since
    GROUP BY 1
  ),
  hashtags_prev AS (
    SELECT public.nv_hashtag_display(norm_tag) AS tag,
           count(DISTINCT post_key)::bigint AS prev_c
    FROM hashtags_filtered
    WHERE ts >= v_prev_since AND ts < v_since
    GROUP BY 1
  ),
  hashtags AS (
    SELECT c.tag, c.c, c.raw_c,
           COALESCE(p.prev_c, 0)::bigint AS prev_c,
           CASE WHEN c.c > 0
                THEN round(((c.raw_c - c.c)::numeric / c.c) * 100, 2)
                ELSE 0 END AS inflation_pct
    FROM hashtags_cur c LEFT JOIN hashtags_prev p USING (tag)
    WHERE c.tag IS NOT NULL
    ORDER BY c.c DESC
    LIMIT 20
  )
  SELECT jsonb_build_object(
    'topics',  (SELECT coalesce(jsonb_agg(to_jsonb(topics.*)   ORDER BY mentions DESC), '[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),        '[]'::jsonb) FROM hashtags),
    'meta', jsonb_build_object(
       'source','social_interactions',
       'dedup_key','COALESCE(post_url,external_id,post_id,id)',
       'window_days',v_days,
       'threshold_political',5
    )
  ),
  (SELECT count(*) FROM topics) + (SELECT count(*) FROM hashtags)
  INTO v_data, v_records;

  v_duration := floor(extract(epoch FROM (clock_timestamp() - v_started)) * 1000)::int;

  INSERT INTO public.network_view_cache
    (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES
    (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,v_records,v_duration,
     '{"source":"social_interactions","dedup":true,"version":"v3"}'::jsonb,
     now() + interval '5 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET
    result=EXCLUDED.result, source_rows=EXCLUDED.source_rows,
    duration_ms=EXCLUDED.duration_ms, plan=EXCLUDED.plan,
    expires_at=EXCLUDED.expires_at, updated_at=now();

  PERFORM public.log_network_view_query(v_uid,'content',p_candidate_id,v_network,v_days,
    false,v_duration,v_records,v_records,
    CASE WHEN v_duration > 2000 THEN 'slow' ELSE 'success' END, NULL,
    '{"source":"social_interactions","version":"v3"}'::jsonb);

  RETURN jsonb_build_object('ok',true,'data',v_data,
    'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration,
    'source','social_interactions','records',v_records));
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.',
    'error', SQLERRM);
END;
$function$;

-- =========================================================
-- C3a: Candidate comparison timeline (server-side aggregate)
-- =========================================================
CREATE OR REPLACE FUNCTION public.candidates_comparison_timeline(
  _candidate_ids uuid[],
  _days integer DEFAULT 14
)
RETURNS TABLE (day date, candidate_id uuid, mentions bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      greatest(1, least(coalesce(_days,14), 365)) AS d,
      public.has_role(auth.uid(),'admin'::app_role) AS is_admin,
      auth.uid() AS uid
  )
  SELECT
    (public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at))::date AS day,
    si.candidate_id,
    count(*)::bigint AS mentions
  FROM public.social_interactions si, params p
  WHERE si.candidate_id = ANY(_candidate_ids)
    AND (p.is_admin OR si.user_id = p.uid)
    AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at)
        >= now() - (p.d || ' days')::interval
  GROUP BY 1, 2
  ORDER BY 1, 2;
$function$;

GRANT EXECUTE ON FUNCTION public.candidates_comparison_timeline(uuid[], integer) TO authenticated;

-- =========================================================
-- C3b: Collection status summary per network (24h)
-- =========================================================
CREATE OR REPLACE FUNCTION public.collection_status_summary()
RETURNS TABLE (
  network text,
  last_collected_at timestamptz,
  last24h_count bigint,
  total_30d bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT public.has_role(auth.uid(),'admin'::app_role) AS is_admin, auth.uid() AS uid
  )
  SELECT
    public.nv_network_key(si.social_network) AS network,
    max(public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at)) AS last_collected_at,
    count(*) FILTER (WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= now() - interval '24 hours')::bigint AS last24h_count,
    count(*) FILTER (WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= now() - interval '30 days')::bigint AS total_30d
  FROM public.social_interactions si, params p
  WHERE (p.is_admin OR si.user_id = p.uid)
    AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= now() - interval '30 days'
  GROUP BY 1
  ORDER BY last24h_count DESC NULLS LAST;
$function$;

GRANT EXECUTE ON FUNCTION public.collection_status_summary() TO authenticated;
