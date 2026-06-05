CREATE OR REPLACE FUNCTION public.social_interactions_enrich_post_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  calculated_engagement bigint := (coalesce(NEW.likes_count, 0) + coalesce(NEW.replies_count, 0) + coalesce(NEW.shares_count, 0))::bigint;
BEGIN
  NEW.platform := coalesce(public.normalize_social_platform(NEW.platform), public.normalize_social_platform(NEW.social_network), 'unknown');
  NEW.engagement_score := greatest(coalesce(NEW.engagement_score, 0), calculated_engagement);
  IF NEW.post_url IS NULL AND NEW.author_profile_url ~ '^https://' AND NEW.interaction_type IN ('post','video','tweet','news','mention') THEN
    NEW.post_url := NEW.author_profile_url;
  END IF;
  IF nullif(NEW.post_title, '') IS NULL THEN
    NEW.post_title := nullif(split_part(coalesce(NEW.comment_text, ''), E'\n', 1), '');
  END IF;
  IF nullif(NEW.post_description, '') IS NULL THEN
    NEW.post_description := nullif(coalesce(NEW.comment_text, ''), '');
  END IF;
  IF nullif(NEW.author_name, '') IS NULL THEN
    NEW.author_name := nullif(NEW.comment_author, '');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_reactions_top_posts(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL::uuid,
  _period_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _period_end timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
  v_limit integer := greatest(1, least(coalesce(_limit, 5), 20));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  WITH base AS (
    SELECT
      si.*,
      coalesce(public.normalize_social_platform(si.platform), public.normalize_social_platform(si.social_network), 'unknown') AS canonical_platform,
      greatest(coalesce(si.engagement_score,0), (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint) AS engagement,
      CASE
        WHEN si.post_url ~ '^https://[^[:space:]]+$' THEN si.post_url
        WHEN si.author_profile_url ~ '^https://[^[:space:]]+$' AND si.interaction_type IN ('post','video','tweet','news','mention') THEN si.author_profile_url
        ELSE NULL
      END AS final_post_url,
      coalesce(nullif(si.post_title,''), nullif(split_part(coalesce(si.comment_text,''), E'\n', 1), '')) AS final_post_title,
      coalesce(nullif(si.post_description,''), nullif(si.comment_text,'')) AS final_post_description,
      coalesce(nullif(si.author_name,''), nullif(si.comment_author,'')) AS final_author_name,
      public.social_interaction_political_score(
        si.candidate_id,
        concat_ws(' ', si.post_title, si.post_description, si.comment_text, si.comment_author, si.author_name, si.author_handle, si.author_profile_url, si.social_network),
        concat_ws(' ', si.comment_author, si.author_name, si.author_handle),
        si.social_network
      ) AS live_verdict
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.is_political_content = true
      AND si.invalidated_at IS NULL
      AND si.political_relevance_score >= 3
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
      AND coalesce(public.normalize_social_platform(si.platform), public.normalize_social_platform(si.social_network), 'unknown') IN ('youtube','instagram','facebook','tiktok','twitter','google_news','portal')
      AND public.norm_text(concat_ws(' ', si.post_title, si.post_description, si.comment_text, si.comment_author, si.author_name, si.author_handle, si.author_profile_url)) NOT LIKE ALL (ARRAY['%danilo gentili%','%the noite%','%tve bahia%','%turma da monica%','%mauricio de sousa%','%mauricio de souza%','%the movie%','%official mv%','%music video%','%musica%','%bateria%','%filme%','%novela%','%humor%','%variedades%'])
  ), eligible AS (
    SELECT *
    FROM base
    WHERE final_post_url IS NOT NULL
      AND coalesce((live_verdict->>'is_political')::boolean, false) = true
      AND final_post_title IS NOT NULL
      AND final_author_name IS NOT NULL
      AND engagement > 0
  ), platform_ranked AS (
    SELECT *,
      row_number() OVER (PARTITION BY canonical_platform ORDER BY engagement DESC, coalesce(collected_at, created_at) DESC) AS platform_position
    FROM eligible
  ), diversified AS (
    SELECT *
    FROM platform_ranked
    WHERE platform_position <= 2
    ORDER BY engagement DESC, coalesce((live_verdict->>'score')::numeric, political_relevance_score) DESC, coalesce(collected_at, created_at) DESC
    LIMIT v_limit
  ), backfill AS (
    SELECT * FROM diversified
    UNION ALL
    SELECT pr.*
    FROM platform_ranked pr
    WHERE NOT EXISTS (SELECT 1 FROM diversified d WHERE d.id = pr.id)
      AND (SELECT count(*) FROM diversified) < v_limit
    ORDER BY engagement DESC, coalesce((live_verdict->>'score')::numeric, political_relevance_score) DESC, coalesce(collected_at, created_at) DESC
    LIMIT greatest(0, v_limit - (SELECT count(*) FROM diversified))
  ), ranked AS (
    SELECT * FROM backfill
    ORDER BY engagement DESC, coalesce((live_verdict->>'score')::numeric, political_relevance_score) DESC, coalesce(collected_at, created_at) DESC
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'platform', canonical_platform,
    'social_network', CASE canonical_platform WHEN 'youtube' THEN 'YouTube' WHEN 'instagram' THEN 'Instagram' WHEN 'facebook' THEN 'Facebook' WHEN 'tiktok' THEN 'TikTok' WHEN 'twitter' THEN 'X/Twitter' WHEN 'google_news' THEN 'Google News' WHEN 'portal' THEN 'Portal de notícia' ELSE initcap(replace(coalesce(nullif(social_network,''),'outro'),'_',' ')) END,
    'social_network_raw', canonical_platform,
    'likes_count', coalesce(likes_count,0),
    'replies_count', coalesce(replies_count,0),
    'shares_count', coalesce(shares_count,0),
    'sentiment_label', CASE WHEN lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo' WHEN lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo' WHEN lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro' ELSE NULL END,
    'collected_at', coalesce(collected_at, created_at),
    'engagement', engagement,
    'engagement_score', engagement,
    'post_url', final_post_url,
    'post_title', final_post_title,
    'post_description', final_post_description,
    'thumbnail_url', thumbnail_url,
    'author_name', final_author_name,
    'author_handle', author_handle,
    'author_profile_url', author_profile_url,
    'post_id', post_id,
    'political_relevance_score', coalesce((live_verdict->>'score')::numeric, political_relevance_score),
    'political_validation_reason', coalesce(live_verdict->>'reason', political_validation_reason)
  ) ORDER BY engagement DESC), '[]'::jsonb) INTO v_result FROM ranked;

  RETURN coalesce(v_result,'[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_interactions_enrich_post_metadata() TO service_role;