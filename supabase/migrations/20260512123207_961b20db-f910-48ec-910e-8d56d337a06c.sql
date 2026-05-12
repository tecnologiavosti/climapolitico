
UPDATE public.social_interactions SET sentiment_label = 'Positivo' WHERE sentiment_label IN ('positive','POSITIVE');
UPDATE public.social_interactions SET sentiment_label = 'Negativo' WHERE sentiment_label IN ('negative','NEGATIVE');
UPDATE public.social_interactions SET sentiment_label = 'Neutro'   WHERE sentiment_label IN ('neutral','NEUTRAL');
DELETE FROM public.candidate_metrics_cache;
