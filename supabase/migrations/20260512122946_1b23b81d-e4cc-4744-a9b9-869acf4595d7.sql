
UPDATE public.social_interactions SET sentiment_label = 'Positivo' WHERE sentiment_label = 'positive';
UPDATE public.social_interactions SET sentiment_label = 'Negativo' WHERE sentiment_label = 'negative';
UPDATE public.social_interactions SET sentiment_label = 'Neutro'   WHERE sentiment_label = 'neutral';
