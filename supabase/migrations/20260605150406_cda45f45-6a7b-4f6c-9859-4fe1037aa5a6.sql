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
  v_result jsonb := '[]'::jsonb;
  v_limit integer := greatest(1, least(coalesce(_limit, 5), 20));
  v_anchor timestamptz := coalesce(_period_end, now());
  v_windows interval[] := ARRAY[
    interval '24 hours',
    interval '3 days',
    interval '7 days',
    interval '30 days',
    NULL::interval
  ];
  v_window interval;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  FOREACH v_window IN ARRAY v_windows LOOP
    WITH scoped AS (
      SELECT
        si.*,
        coalesce(si.collected_at, si.created_at) AS effective_at,
        CASE
          WHEN si.post_url ILIKE 'https://bsky.app/%' OR si.author_profile_url ILIKE 'https://bsky.app/%' THEN 'bluesky'
          WHEN si.post_url ILIKE '%mastodon.%' OR si.author_profile_url ILIKE '%mastodon.%' OR si.post_url ILIKE '%mas.to/%' OR si.author_profile_url ILIKE '%mas.to/%' OR si.post_url ILIKE '%masto.ai/%' OR si.author_profile_url ILIKE '%masto.ai/%' THEN 'mastodon'
          WHEN si.post_url ILIKE '%youtube.com/%' OR si.post_url ILIKE '%youtu.be/%' THEN 'youtube'
          WHEN si.post_url ILIKE '%instagram.com/%' THEN 'instagram'
          WHEN si.post_url ILIKE '%facebook.com/%' OR si.post_url ILIKE '%fb.watch/%' THEN 'facebook'
          WHEN si.post_url ILIKE '%tiktok.com/%' THEN 'tiktok'
          WHEN si.post_url ILIKE '%x.com/%' OR si.post_url ILIKE '%twitter.com/%' THEN 'twitter'
          WHEN si.post_url ILIKE '%reddit.com/%' THEN 'reddit'
          ELSE coalesce(public.normalize_social_platform(si.platform), public.normalize_social_platform(si.social_network), 'unknown')
        END AS canonical_platform,
        public.norm_text(concat_ws(' ',
          si.post_title,
          si.post_description,
          si.comment_text,
          si.comment_author,
          si.author_name,
          si.author_handle,
          si.author_profile_url,
          si.post_url,
          si.social_network,
          si.platform
        )) AS text_norm
      FROM public.social_interactions si
      WHERE (v_is_admin OR si.user_id = _user_id)
        AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
        AND si.invalidated_at IS NULL
        AND (v_window IS NULL OR coalesce(si.collected_at, si.created_at) >= v_anchor - v_window)
        AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
    ), normalized AS (
      SELECT
        s.*,
        CASE
          WHEN s.post_url ~ '^https://[^[:space:]]+$' THEN btrim(s.post_url)
          WHEN s.canonical_platform = 'youtube' AND nullif(s.post_id, '') IS NOT NULL THEN 'https://www.youtube.com/watch?v=' || btrim(s.post_id)
          WHEN s.canonical_platform = 'twitter' AND nullif(s.post_id, '') IS NOT NULL AND nullif(s.author_handle, '') IS NOT NULL THEN 'https://x.com/' || regexp_replace(btrim(s.author_handle), '^@', '') || '/status/' || btrim(s.post_id)
          WHEN s.canonical_platform = 'tiktok' AND nullif(s.post_id, '') IS NOT NULL AND nullif(s.author_handle, '') IS NOT NULL THEN 'https://www.tiktok.com/@' || regexp_replace(btrim(s.author_handle), '^@', '') || '/video/' || btrim(s.post_id)
          WHEN s.canonical_platform = 'instagram' AND nullif(s.post_id, '') IS NOT NULL THEN 'https://www.instagram.com/p/' || btrim(s.post_id) || '/'
          WHEN s.canonical_platform = 'facebook' AND nullif(s.post_id, '') IS NOT NULL AND nullif(s.author_handle, '') IS NOT NULL THEN 'https://www.facebook.com/' || regexp_replace(btrim(s.author_handle), '^@', '') || '/posts/' || btrim(s.post_id)
          WHEN s.author_profile_url ~ '^https://[^[:space:]]+$' AND s.interaction_type IN ('post','video','tweet','news','mention') THEN btrim(s.author_profile_url)
          ELSE NULL
        END AS final_post_url,
        nullif(btrim(coalesce(
          nullif(s.post_title, ''),
          nullif(s.post_description, ''),
          nullif(split_part(coalesce(s.comment_text, ''), E'\n', 1), ''),
          'Publicação política em ' || initcap(replace(coalesce(nullif(s.canonical_platform, ''), 'rede social'), '_', ' '))
        )), '') AS final_post_title,
        nullif(btrim(coalesce(nullif(s.post_description, ''), nullif(s.comment_text, ''), nullif(s.post_title, ''))), '') AS final_post_description,
        nullif(btrim(coalesce(nullif(s.author_name, ''), nullif(s.comment_author, ''), nullif(s.author_handle, ''), initcap(replace(coalesce(nullif(s.canonical_platform, ''), 'fonte'), '_', ' ')))), '') AS final_author_name,
        greatest(coalesce(s.engagement_score, 0), (coalesce(s.likes_count, 0) + coalesce(s.replies_count, 0) + coalesce(s.shares_count, 0))::bigint, 1) AS row_engagement,
        (
          coalesce(s.political_relevance_score, 0)
          + CASE WHEN s.is_political_content IS TRUE THEN 2 ELSE 0 END
          + CASE WHEN s.interaction_type IN ('news','post','video','tweet','mention') THEN 1 ELSE 0 END
          + CASE WHEN coalesce(s.canonical_platform, '') IN ('google_news','portal','gdelt','youtube','twitter','facebook','instagram','tiktok','telegram','linkedin','reddit','bluesky','mastodon','lemmy') THEN 1 ELSE 0 END
          + CASE WHEN s.text_norm ~ '(politic|politico|politica|eleic|eleicao|eleicoes|governo|governador|president|senador|deputad|prefeit|vereador|ministro|ministerio|camara|senado|congresso|assembleia|planalto|stf|tse|tcu|pgr|partido|campanha|candidat|coligac|federac|debate|entrevista|discurso|coletiva|pronunciamento|agenda|mandato|posse|prefeitura|lula|bolsonaro|haddad|tarcisio|zema|caiado|boulos|marcal|pacheco|lira|moraes|dino)' THEN 3 ELSE 0 END
        )::numeric AS broad_political_score
      FROM scoped s
      WHERE coalesce(nullif(s.canonical_platform, ''), 'unknown') <> 'unknown'
    ), eligible AS (
      SELECT *
      FROM normalized n
      WHERE n.final_post_url IS NOT NULL
        AND n.final_post_title IS NOT NULL
        AND n.broad_political_score >= 2
        AND NOT (
          n.is_political_content IS DISTINCT FROM TRUE
          AND n.broad_political_score < 5
          AND n.text_norm ~ '(novela|reality|bbb|big brother|futebol|gameplay|trailer|videoclipe|music video|lyrics|receita|culinaria|unboxing|minecraft|fortnite|free fire)'
        )
    ), deduped AS (
      SELECT
        e.*,
        row_number() OVER (
          PARTITION BY e.final_post_url
          ORDER BY
            e.broad_political_score DESC,
            e.row_engagement DESC,
            e.effective_at DESC,
            CASE WHEN e.final_author_name IS NOT NULL THEN 0 ELSE 1 END
        ) AS metadata_rank
      FROM eligible e
    ), aggregate_by_url AS (
      SELECT
        final_post_url,
        canonical_platform,
        sum(row_engagement)::bigint AS engagement,
        sum(coalesce(likes_count, 0))::bigint AS likes_count,
        sum(coalesce(replies_count, 0))::bigint AS replies_count,
        sum(coalesce(shares_count, 0))::bigint AS shares_count,
        max(broad_political_score) AS political_score,
        max(effective_at) AS latest_collected_at,
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
        CASE
          WHEN m.thumbnail_url ~ '^https://[^[:space:]]+$' THEN btrim(m.thumbnail_url)
          WHEN a.canonical_platform = 'youtube' AND nullif(m.post_id, '') IS NOT NULL THEN 'https://img.youtube.com/vi/' || btrim(m.post_id) || '/hqdefault.jpg'
          ELSE NULL
        END AS final_thumbnail_url,
        m.final_author_name,
        m.author_handle,
        CASE WHEN m.author_profile_url ~ '^https://[^[:space:]]+$' THEN m.author_profile_url ELSE NULL END AS author_profile_url,
        m.post_id,
        a.political_score,
        m.political_validation_reason,
        a.related_records,
        (
          ln(1 + greatest(a.engagement, 1))
          * (0.20 + exp(-greatest(0, extract(epoch from (v_anchor - a.latest_collected_at)) / 3600) / 52))
          + (a.political_score * 0.03)
        ) AS rank_score
      FROM aggregate_by_url a
      JOIN deduped m
        ON m.final_post_url = a.final_post_url
       AND m.canonical_platform = a.canonical_platform
       AND m.metadata_rank = 1
    ), platform_ranked AS (
      SELECT
        p.*,
        row_number() OVER (PARTITION BY p.canonical_platform ORDER BY p.rank_score DESC, p.engagement DESC, p.political_score DESC, p.collected_at DESC) AS platform_position
      FROM posts p
    ), primary_pick AS (
      SELECT *, 1 AS diversity_tier
      FROM platform_ranked
      WHERE platform_position = 1
      ORDER BY rank_score DESC, engagement DESC, political_score DESC, collected_at DESC
      LIMIT v_limit
    ), secondary_pick AS (
      SELECT pr.*, 2 AS diversity_tier
      FROM platform_ranked pr
      WHERE pr.platform_position = 2
        AND NOT EXISTS (SELECT 1 FROM primary_pick pp WHERE pp.final_post_url = pr.final_post_url)
        AND (SELECT count(*) FROM primary_pick) < v_limit
      ORDER BY pr.rank_score DESC, pr.engagement DESC, pr.political_score DESC, pr.collected_at DESC
      LIMIT greatest(0, v_limit - (SELECT count(*) FROM primary_pick))
    ), overflow_pick AS (
      SELECT pr.*, 3 AS diversity_tier
      FROM platform_ranked pr
      WHERE pr.platform_position <= 2
        AND NOT EXISTS (SELECT 1 FROM primary_pick pp WHERE pp.final_post_url = pr.final_post_url)
        AND NOT EXISTS (SELECT 1 FROM secondary_pick sp WHERE sp.final_post_url = pr.final_post_url)
        AND (SELECT count(*) FROM primary_pick) + (SELECT count(*) FROM secondary_pick) < v_limit
      ORDER BY pr.rank_score DESC, pr.engagement DESC, pr.political_score DESC, pr.collected_at DESC
      LIMIT greatest(0, v_limit - (SELECT count(*) FROM primary_pick) - (SELECT count(*) FROM secondary_pick))
    ), selected AS (
      SELECT * FROM primary_pick
      UNION ALL SELECT * FROM secondary_pick
      UNION ALL SELECT * FROM overflow_pick
    ), ranked AS (
      SELECT *
      FROM selected
      ORDER BY rank_score DESC, diversity_tier ASC, engagement DESC, political_score DESC, collected_at DESC
      LIMIT v_limit
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'platform', canonical_platform,
      'social_network', CASE canonical_platform
        WHEN 'youtube' THEN 'YouTube' WHEN 'instagram' THEN 'Instagram' WHEN 'facebook' THEN 'Facebook'
        WHEN 'tiktok' THEN 'TikTok' WHEN 'twitter' THEN 'X/Twitter' WHEN 'google_news' THEN 'Google News'
        WHEN 'portal' THEN 'Portal de notícia' WHEN 'gdelt' THEN 'Portal de notícia' WHEN 'bluesky' THEN 'Bluesky'
        WHEN 'reddit' THEN 'Reddit' WHEN 'telegram' THEN 'Telegram' WHEN 'linkedin' THEN 'LinkedIn'
        WHEN 'mastodon' THEN 'Mastodon' WHEN 'lemmy' THEN 'Lemmy' WHEN 'tumblr' THEN 'Tumblr'
        WHEN 'pinterest' THEN 'Pinterest' ELSE initcap(replace(coalesce(nullif(social_network, ''), canonical_platform), '_', ' ')) END,
      'social_network_raw', canonical_platform,
      'likes_count', coalesce(likes_count, 0),
      'replies_count', coalesce(replies_count, 0),
      'shares_count', coalesce(shares_count, 0),
      'sentiment_label', CASE WHEN lower(coalesce(sentiment_label, '')) IN ('positivo','positive','pos') THEN 'Positivo' WHEN lower(coalesce(sentiment_label, '')) IN ('negativo','negative','neg') THEN 'Negativo' WHEN lower(coalesce(sentiment_label, '')) IN ('neutro','neutral','neu') THEN 'Neutro' ELSE NULL END,
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
      'political_validation_reason', coalesce(political_validation_reason, 'Relevância política ampla: conteúdo coletado de candidato, notícia política, entrevista, debate, discurso, coletiva, agenda, campanha, partido ou governo.'),
      'related_records', related_records
    ) ORDER BY rank_score DESC, diversity_tier ASC, engagement DESC, political_score DESC, collected_at DESC), '[]'::jsonb)
    INTO v_result
    FROM ranked;

    IF jsonb_array_length(coalesce(v_result, '[]'::jsonb)) > 0 THEN
      RETURN v_result;
    END IF;
  END LOOP;

  RETURN '[]'::jsonb;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;