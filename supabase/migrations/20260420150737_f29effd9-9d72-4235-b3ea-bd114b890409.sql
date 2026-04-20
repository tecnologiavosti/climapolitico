UPDATE public.youtube_api_keys SET is_active = true, quota_exceeded_count = 0, last_quota_exceeded_at = NULL WHERE label = 'Projeto YT-2';

INSERT INTO public.candidate_metrics_cache (user_id, candidate_id, total_mentions, unique_authors, total_engagement, total_likes, total_replies, total_shares, positive_count, neutral_count, negative_count, average_sentiment, network_breakdown, last_calculated_at)
SELECT c.user_id, c.id, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, '[]'::jsonb, now()
FROM public.candidates c
LEFT JOIN public.candidate_metrics_cache cmc ON cmc.candidate_id = c.id
WHERE cmc.id IS NULL;