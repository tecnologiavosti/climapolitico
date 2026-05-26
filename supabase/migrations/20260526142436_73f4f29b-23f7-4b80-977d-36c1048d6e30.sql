CREATE INDEX IF NOT EXISTS idx_social_interactions_user_effective_at
ON public.social_interactions (user_id, (coalesce(collected_at, created_at)) DESC);

CREATE INDEX IF NOT EXISTS idx_social_interactions_user_candidate_effective_at
ON public.social_interactions (user_id, candidate_id, (coalesce(collected_at, created_at)) DESC);

CREATE INDEX IF NOT EXISTS idx_social_interactions_candidate_effective_at
ON public.social_interactions (candidate_id, (coalesce(collected_at, created_at)) DESC);

CREATE OR REPLACE FUNCTION public.get_reactions_per_post_summary(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL,
  _period_start timestamptz DEFAULT NULL,
  _period_end timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH filtered AS MATERIALIZED (
    SELECT
      si.id,
      si.social_network,
      lower(coalesce(si.interaction_type, 'comment')) AS interaction_type,
      si.sentiment_label,
      coalesce(si.likes_count, 0) AS likes_count,
      coalesce(si.replies_count, 0) AS replies_count,
      coalesce(si.shares_count, 0) AS shares_count,
      coalesce(si.collected_at, si.created_at) AS effective_at
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND lower(coalesce(si.social_network, '')) NOT IN ('mastodon', 'lemmy', 'pinterest', 'gdelt')
  ), agg AS (
    SELECT
      count(*)::bigint AS total_records,
      count(*) FILTER (WHERE interaction_type IN ('post', 'mention', 'tweet', 'news', 'video', 'article', 'section', 'related', 'revision'))::bigint AS posts_count,
      count(*) FILTER (WHERE interaction_type IN ('comment', 'reply', 'subcomment', 'response'))::bigint AS comments_count,
      count(*) FILTER (WHERE sentiment_label IN ('Positivo', 'positive', 'POSITIVE'))::bigint AS positive_count,
      count(*) FILTER (WHERE sentiment_label IN ('Negativo', 'negative', 'NEGATIVE'))::bigint AS negative_count,
      count(*) FILTER (WHERE sentiment_label IN ('Neutro', 'neutral', 'NEUTRAL'))::bigint AS neutral_count,
      count(*) FILTER (WHERE sentiment_label IN ('Positivo', 'positive', 'POSITIVE', 'Negativo', 'negative', 'NEGATIVE', 'Neutro', 'neutral', 'NEUTRAL'))::bigint AS classified_count,
      count(*) FILTER (WHERE sentiment_label IS NULL OR sentiment_label NOT IN ('Positivo', 'positive', 'POSITIVE', 'Negativo', 'negative', 'NEGATIVE', 'Neutro', 'neutral', 'NEUTRAL'))::bigint AS pending_count,
      coalesce(sum(likes_count), 0)::bigint AS total_likes,
      coalesce(sum(replies_count), 0)::bigint AS total_replies,
      coalesce(sum(shares_count), 0)::bigint AS total_shares
    FROM filtered
  ), network_hits AS (
    SELECT coalesce(nullif(social_network, ''), 'outro') AS network, count(*)::bigint AS total
    FROM filtered
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 12
  ), top_posts AS (
    SELECT
      id,
      coalesce(nullif(social_network, ''), 'outro') AS social_network,
      likes_count,
      replies_count,
      shares_count,
      sentiment_label,
      effective_at AS collected_at,
      (likes_count + replies_count + shares_count)::bigint AS engagement
    FROM filtered
    ORDER BY (likes_count + replies_count + shares_count) DESC, effective_at DESC NULLS LAST
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'totalRecords', coalesce(a.total_records, 0),
    'postsCount', coalesce(a.posts_count, 0),
    'commentsCount', coalesce(a.comments_count, 0),
    'positiveCount', coalesce(a.positive_count, 0),
    'negativeCount', coalesce(a.negative_count, 0),
    'neutralCount', coalesce(a.neutral_count, 0),
    'classifiedCount', coalesce(a.classified_count, 0),
    'pendingCount', coalesce(a.pending_count, 0),
    'totalLikes', coalesce(a.total_likes, 0),
    'totalReplies', coalesce(a.total_replies, 0),
    'totalShares', coalesce(a.total_shares, 0),
    'totalInteractions', coalesce(a.total_likes, 0) + coalesce(a.total_replies, 0) + coalesce(a.total_shares, 0),
    'dominantTopics', '[]'::jsonb,
    'networkBreakdown', coalesce((SELECT jsonb_agg(jsonb_build_object('network', network, 'total', total)) FROM network_hits), '[]'::jsonb),
    'topPosts', coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'social_network', social_network,
      'likes_count', likes_count,
      'replies_count', replies_count,
      'shares_count', shares_count,
      'sentiment_label', sentiment_label,
      'collected_at', collected_at,
      'engagement', engagement
    )) FROM top_posts), '[]'::jsonb)
  ) INTO v_result
  FROM agg a;

  RETURN coalesce(v_result, jsonb_build_object(
    'totalRecords', 0,
    'postsCount', 0,
    'commentsCount', 0,
    'positiveCount', 0,
    'negativeCount', 0,
    'neutralCount', 0,
    'classifiedCount', 0,
    'pendingCount', 0,
    'totalLikes', 0,
    'totalReplies', 0,
    'totalShares', 0,
    'totalInteractions', 0,
    'dominantTopics', '[]'::jsonb,
    'networkBreakdown', '[]'::jsonb,
    'topPosts', '[]'::jsonb
  ));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO service_role;