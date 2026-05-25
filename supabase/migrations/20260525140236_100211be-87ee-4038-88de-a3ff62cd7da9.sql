REVOKE EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enqueue_pending_sentiment_jobs(uuid, uuid, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_per_post_summary(uuid, uuid, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_pending_sentiment_jobs(uuid, uuid, timestamptz, timestamptz, integer) TO authenticated;