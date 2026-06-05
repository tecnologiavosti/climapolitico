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
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'social_network', social_network,
    'social_network_raw', social_network_raw,
    'likes_count', likes_count,
    'replies_count', replies_count,
    'shares_count', shares_count,
    'sentiment_label', sentiment_label,
    'collected_at', collected_at,
    'engagement', engagement,
    'post_url', post_url,
    'post_title', post_title,
    'post_description', post_description,
    'thumbnail_url', thumbnail_url,
    'author_name', author_name,
    'author_handle', author_handle,
    'author_profile_url', author_profile_url,
    'post_id', post_id,
    'political_relevance_score', political_relevance_score,
    'political_validation_reason', political_validation_reason
  ) ORDER BY engagement DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      si.id,
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS social_network,
      lower(coalesce(si.social_network,'')) AS social_network_raw,
      coalesce(si.likes_count,0) AS likes_count,
      coalesce(si.replies_count,0) AS replies_count,
      coalesce(si.shares_count,0) AS shares_count,
      CASE
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro'
        ELSE NULL
      END AS sentiment_label,
      coalesce(si.collected_at, si.created_at) AS collected_at,
      (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint AS engagement,
      coalesce(si.post_url, CASE WHEN si.author_profile_url ~ '^https?://' THEN si.author_profile_url ELSE NULL END) AS post_url,
      coalesce(nullif(si.post_title,''), nullif(split_part(si.comment_text, E'\n', 1), '')) AS post_title,
      coalesce(nullif(si.post_description,''), nullif(si.comment_text,'')) AS post_description,
      si.thumbnail_url,
      coalesce(nullif(si.author_name,''), nullif(si.comment_author,'')) AS author_name,
      si.author_handle,
      si.author_profile_url,
      si.post_id,
      si.political_relevance_score,
      si.political_validation_reason
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.is_political_content = true
      AND si.invalidated_at IS NULL
      AND si.political_relevance_score >= 3
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
    ORDER BY engagement DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(_limit,5), 20))
  ) t;

  RETURN coalesce(v_result,'[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;