UPDATE public.social_interactions
SET sentiment_label = NULL,
    sentiment_score = NULL
WHERE social_network = 'Twitter/X'
  AND sentiment_label = 'Neutro'
  AND sentiment_score = 0.5
  AND created_at >= now() - interval '7 days';