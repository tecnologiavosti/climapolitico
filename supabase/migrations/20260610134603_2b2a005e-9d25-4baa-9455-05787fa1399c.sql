
CREATE OR REPLACE FUNCTION public.event_ssot_correlation(
  p_candidate_id uuid,
  p_start timestamptz,
  p_end timestamptz
) RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      public.nv_network_key(social_network) AS net,
      COALESCE(NULLIF(comment_author,''), NULLIF(author_handle,''), NULLIF(author_name,''), id::text) AS author_key,
      COALESCE(likes_count,0) + COALESCE(replies_count,0) + COALESCE(shares_count,0) AS engagement
    FROM public.social_interactions
    WHERE candidate_id = p_candidate_id
      AND invalidated_at IS NULL
      AND COALESCE(is_political_content, true) = true
      AND COALESCE(original_posted_at, created_at, collected_at) >= p_start
      AND COALESCE(original_posted_at, created_at, collected_at) <  p_end
  ),
  by_net AS (
    SELECT net, COUNT(*)::bigint AS mentions FROM base GROUP BY net
  )
  SELECT jsonb_build_object(
    'total_mentions',   (SELECT COUNT(*)::bigint FROM base),
    'unique_authors',   (SELECT COUNT(DISTINCT author_key)::bigint FROM base),
    'total_engagement', (SELECT COALESCE(SUM(engagement),0)::bigint FROM base),
    'by_network',       (SELECT COALESCE(jsonb_object_agg(net, mentions), '{}'::jsonb) FROM by_net)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.event_ssot_correlation(uuid,timestamptz,timestamptz) FROM anon;
GRANT  EXECUTE ON FUNCTION public.event_ssot_correlation(uuid,timestamptz,timestamptz) TO authenticated, service_role;
