
CREATE OR REPLACE FUNCTION public.network_view_top_posts(
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
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := current_date::timestamptz - (v_days - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_visible text[] := public.nv_visible_networks();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_top_endpoint_v4', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH recent AS MATERIALIZED (
    SELECT
      si.id,
      si.social_network,
      si.comment_text,
      si.comment_author,
      COALESCE(si.sentiment_label,'Neutro') AS sent,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      COALESCE(si.views_count,0)::bigint AS views,
      -- score: likes*1 + comments*2 + shares*3 + views*0.1
      (COALESCE(si.likes_count,0)
        + COALESCE(si.replies_count,0) * 2
        + COALESCE(si.shares_count,0) * 3
        + COALESCE(si.views_count,0) * 0.1
      )::numeric AS score,
      (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0))::bigint AS eng,
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS canonical_at,
      si.original_posted_at,
      si.collected_at,
      si.post_url,
      si.thumbnail_url,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key,
      COALESCE(si.political_relevance_score,0) AS political_relevance,
      COALESCE(si.is_political_content, true) AS is_political
    FROM public.social_interactions si
    WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_since
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
      AND si.invalidated_at IS NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) = ANY (v_visible)
      AND si.comment_text IS NOT NULL
    ORDER BY public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) DESC
    LIMIT 3000
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM recent
    ORDER BY dedup_key, score DESC, canonical_at DESC
  ), ranked AS (
    -- Primeiro pega top político-relevantes; se houver poucos, completa com não-políticos
    SELECT * FROM deduped WHERE is_political = true
    ORDER BY score DESC, canonical_at DESC
    LIMIT 10
  )
  SELECT jsonb_build_object(
    'top_posts',
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'social_network', social_network,
      'comment_text', comment_text,
      'comment_author', comment_author,
      'sent', sent,
      'eng', eng,
      'score', score,
      'likes', likes,
      'replies', replies,
      'shares', shares,
      'views', views,
      'thumbnail_url', thumbnail_url,
      'original_posted_at', canonical_at,
      'collected_at', collected_at,
      'post_url', post_url
    ) ORDER BY score DESC), '[]'::jsonb)
  ) INTO v_data
  FROM ranked;

  -- Fallback: se nenhum item retornou, pega top por engajamento sem filtro político
  v_count := jsonb_array_length(COALESCE(v_data->'top_posts','[]'::jsonb));
  IF v_count = 0 THEN
    WITH recent2 AS (
      SELECT
        si.id, si.social_network, si.comment_text, si.comment_author,
        COALESCE(si.sentiment_label,'Neutro') AS sent,
        COALESCE(si.likes_count,0)::bigint AS likes,
        COALESCE(si.replies_count,0)::bigint AS replies,
        COALESCE(si.shares_count,0)::bigint AS shares,
        COALESCE(si.views_count,0)::bigint AS views,
        (COALESCE(si.likes_count,0)
          + COALESCE(si.replies_count,0) * 2
          + COALESCE(si.shares_count,0) * 3
          + COALESCE(si.views_count,0) * 0.1
        )::numeric AS score,
        (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0))::bigint AS eng,
        public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS canonical_at,
        si.collected_at, si.post_url, si.thumbnail_url,
        COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key
      FROM public.social_interactions si
      WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_since
        AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
        AND si.invalidated_at IS NULL
        AND (v_is_admin OR si.user_id = v_uid)
        AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
        AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
        AND public.nv_network_key(si.social_network) = ANY (v_visible)
        AND si.comment_text IS NOT NULL
      ORDER BY public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) DESC
      LIMIT 3000
    ), deduped2 AS (
      SELECT DISTINCT ON (dedup_key) * FROM recent2 ORDER BY dedup_key, score DESC, canonical_at DESC
    )
    SELECT jsonb_build_object(
      'top_posts',
      COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'social_network', social_network, 'comment_text', comment_text,
        'comment_author', comment_author, 'sent', sent, 'eng', eng, 'score', score,
        'likes', likes, 'replies', replies, 'shares', shares, 'views', views,
        'thumbnail_url', thumbnail_url,
        'original_posted_at', canonical_at, 'collected_at', collected_at, 'post_url', post_url
      ) ORDER BY score DESC), '[]'::jsonb)
    ) INTO v_data
    FROM (SELECT * FROM deduped2 ORDER BY score DESC, canonical_at DESC LIMIT 10) sub;
  END IF;

  INSERT INTO public.network_view_cache (cache_key, result, expires_at, created_at, last_hit_at)
  VALUES (v_cache_key, v_data, now() + interval '5 minutes', now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at, last_hit_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_data,
    'diagnostics', jsonb_build_object(
      'cache_hit', false,
      'duration_ms', EXTRACT(MILLISECOND FROM (clock_timestamp() - v_started))::int,
      'used_fallback', v_count = 0
    )
  );
END;
$function$;
