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

  WITH raw AS (
    SELECT
      si.*,
      CASE
        WHEN si.post_url ILIKE 'https://bsky.app/%' OR si.author_profile_url ILIKE 'https://bsky.app/%' THEN 'bluesky'
        WHEN si.post_url ILIKE '%mastodon.%' OR si.author_profile_url ILIKE '%mastodon.%' OR si.post_url ILIKE '%mas.to/%' OR si.author_profile_url ILIKE '%mas.to/%' OR si.post_url ILIKE '%masto.ai/%' OR si.author_profile_url ILIKE '%masto.ai/%' THEN 'mastodon'
        ELSE coalesce(public.normalize_social_platform(si.platform), public.normalize_social_platform(si.social_network), 'unknown')
      END AS canonical_platform
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.is_political_content = true
      AND si.invalidated_at IS NULL
      AND coalesce(si.political_relevance_score, 0) >= 2
  ), base AS (
    SELECT
      r.*,
      greatest(coalesce(r.engagement_score,0), (coalesce(r.likes_count,0) + coalesce(r.replies_count,0) + coalesce(r.shares_count,0))::bigint, 1) AS row_engagement,
      CASE
        WHEN r.post_url ~ '^https://[^[:space:]]+$' THEN btrim(r.post_url)
        WHEN r.author_profile_url ~ '^https://[^[:space:]]+$' AND r.interaction_type IN ('post','video','tweet','news','mention') THEN btrim(r.author_profile_url)
        ELSE NULL
      END AS final_post_url,
      coalesce(nullif(r.post_title,''), nullif(split_part(coalesce(r.comment_text,''), E'\n', 1), '')) AS final_post_title,
      coalesce(nullif(r.post_description,''), nullif(r.comment_text,'')) AS final_post_description,
      coalesce(nullif(r.author_name,''), nullif(r.comment_author,''), nullif(r.author_handle,'')) AS final_author_name,
      coalesce(r.political_relevance_score, 0) AS live_score
    FROM raw r
    WHERE r.canonical_platform <> 'unknown'
      AND public.norm_text(concat_ws(' ', r.post_title, r.post_description, r.comment_text, r.comment_author, r.author_name, r.author_handle, r.author_profile_url)) NOT LIKE ALL (ARRAY['%danilo gentili%','%the noite%','%tve bahia%','%turma da monica%','%mauricio de sousa%','%mauricio de souza%','%the movie%','%official mv%','%music video%','%musica%','%bateria%','%filme%','%novela%','%humor%','%variedades%'])
  ), enriched AS (
    SELECT
      b.*,
      CASE
        WHEN b.thumbnail_url ~ '^https://[^[:space:]]+$' THEN btrim(b.thumbnail_url)
        WHEN b.canonical_platform = 'youtube' AND nullif(b.post_id,'') IS NOT NULL THEN 'https://img.youtube.com/vi/' || btrim(b.post_id) || '/hqdefault.jpg'
        WHEN b.canonical_platform = 'youtube' AND b.final_post_url ~ '[?&]v=([A-Za-z0-9_-]{6,})' THEN 'https://img.youtube.com/vi/' || substring(b.final_post_url from '[?&]v=([A-Za-z0-9_-]{6,})') || '/hqdefault.jpg'
        WHEN b.canonical_platform = 'youtube' AND b.final_post_url ~ 'youtu\.be/([A-Za-z0-9_-]{6,})' THEN 'https://img.youtube.com/vi/' || substring(b.final_post_url from 'youtu\.be/([A-Za-z0-9_-]{6,})') || '/hqdefault.jpg'
        ELSE NULL
      END AS final_thumbnail_url
    FROM base b
    WHERE b.final_post_url IS NOT NULL
      AND b.final_post_title IS NOT NULL
  ), deduped AS (
    SELECT
      e.*,
      row_number() OVER (
        PARTITION BY e.final_post_url
        ORDER BY
          CASE WHEN e.final_thumbnail_url IS NOT NULL THEN 0 ELSE 1 END,
          CASE WHEN e.final_author_name IS NOT NULL THEN 0 ELSE 1 END,
          e.row_engagement DESC,
          coalesce(e.collected_at, e.created_at) DESC
      ) AS metadata_rank
    FROM enriched e
  ), aggregate_by_url AS (
    SELECT
      final_post_url,
      canonical_platform,
      sum(row_engagement)::bigint AS engagement,
      sum(coalesce(likes_count,0))::bigint AS likes_count,
      sum(coalesce(replies_count,0))::bigint AS replies_count,
      sum(coalesce(shares_count,0))::bigint AS shares_count,
      max(live_score) AS political_score,
      max(coalesce(collected_at, created_at)) AS latest_collected_at,
      count(*) AS related_records
    FROM deduped
    GROUP BY final_post_url, canonical_platform
  ), posts AS (
    SELECT
      m.id,
      a.canonical_platform,
      m.social_network,
      a.likes_count,
      a.replies_count,
      a.shares_count,
      m.sentiment_label,
      a.latest_collected_at AS collected_at,
      a.engagement,
      a.final_post_url,
      m.final_post_title,
      m.final_post_description,
      m.final_thumbnail_url,
      coalesce(m.final_author_name, initcap(replace(a.canonical_platform, '_', ' '))) AS final_author_name,
      m.author_handle,
      CASE WHEN m.author_profile_url ~ '^https://[^[:space:]]+$' THEN m.author_profile_url ELSE NULL END AS author_profile_url,
      m.post_id,
      a.political_score,
      m.political_validation_reason,
      a.related_records
    FROM aggregate_by_url a
    JOIN deduped m
      ON m.final_post_url = a.final_post_url
     AND m.canonical_platform = a.canonical_platform
     AND m.metadata_rank = 1
  ), platform_ranked AS (
    SELECT
      p.*,
      row_number() OVER (PARTITION BY p.canonical_platform ORDER BY p.engagement DESC, p.political_score DESC, p.collected_at DESC) AS platform_position
    FROM posts p
  ), primary_pick AS (
    SELECT *, 1 AS diversity_tier
    FROM platform_ranked
    WHERE platform_position = 1
    ORDER BY engagement DESC, political_score DESC, collected_at DESC
    LIMIT v_limit
  ), secondary_pick AS (
    SELECT pr.*, 2 AS diversity_tier
    FROM platform_ranked pr
    WHERE pr.platform_position = 2
      AND NOT EXISTS (SELECT 1 FROM primary_pick pp WHERE pp.final_post_url = pr.final_post_url)
      AND (SELECT count(*) FROM primary_pick) < v_limit
    ORDER BY pr.engagement DESC, pr.political_score DESC, pr.collected_at DESC
    LIMIT greatest(0, v_limit - (SELECT count(*) FROM primary_pick))
  ), overflow_pick AS (
    SELECT pr.*, 3 AS diversity_tier
    FROM platform_ranked pr
    WHERE NOT EXISTS (SELECT 1 FROM primary_pick pp WHERE pp.final_post_url = pr.final_post_url)
      AND NOT EXISTS (SELECT 1 FROM secondary_pick sp WHERE sp.final_post_url = pr.final_post_url)
      AND (SELECT count(*) FROM primary_pick) + (SELECT count(*) FROM secondary_pick) < v_limit
    ORDER BY pr.engagement DESC, pr.political_score DESC, pr.collected_at DESC
    LIMIT greatest(0, v_limit - (SELECT count(*) FROM primary_pick) - (SELECT count(*) FROM secondary_pick))
  ), selected AS (
    SELECT * FROM primary_pick
    UNION ALL SELECT * FROM secondary_pick
    UNION ALL SELECT * FROM overflow_pick
  ), ranked AS (
    SELECT *
    FROM selected
    ORDER BY engagement DESC, diversity_tier ASC, political_score DESC, collected_at DESC
    LIMIT v_limit
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'platform', canonical_platform,
    'social_network', CASE canonical_platform
      WHEN 'youtube' THEN 'YouTube' WHEN 'instagram' THEN 'Instagram' WHEN 'facebook' THEN 'Facebook'
      WHEN 'tiktok' THEN 'TikTok' WHEN 'twitter' THEN 'X/Twitter' WHEN 'google_news' THEN 'Google News'
      WHEN 'portal' THEN 'Portal de notícia' WHEN 'bluesky' THEN 'Bluesky' WHEN 'reddit' THEN 'Reddit'
      WHEN 'telegram' THEN 'Telegram' WHEN 'linkedin' THEN 'LinkedIn' WHEN 'mastodon' THEN 'Mastodon'
      WHEN 'lemmy' THEN 'Lemmy' WHEN 'tumblr' THEN 'Tumblr' WHEN 'pinterest' THEN 'Pinterest'
      ELSE initcap(replace(coalesce(nullif(social_network,''), canonical_platform),'_',' ')) END,
    'social_network_raw', canonical_platform,
    'likes_count', coalesce(likes_count,0),
    'replies_count', coalesce(replies_count,0),
    'shares_count', coalesce(shares_count,0),
    'sentiment_label', CASE WHEN lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo' WHEN lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo' WHEN lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro' ELSE NULL END,
    'collected_at', collected_at,
    'engagement', engagement,
    'engagement_score', engagement,
    'post_url', final_post_url,
    'post_title', final_post_title,
    'post_description', final_post_description,
    'thumbnail_url', final_thumbnail_url,
    'author_name', final_author_name,
    'author_handle', author_handle,
    'author_profile_url', author_profile_url,
    'post_id', post_id,
    'political_relevance_score', political_score,
    'political_validation_reason', political_validation_reason,
    'related_records', related_records
  ) ORDER BY engagement DESC, diversity_tier ASC, political_score DESC, collected_at DESC), '[]'::jsonb) INTO v_result FROM ranked;

  RETURN coalesce(v_result,'[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;