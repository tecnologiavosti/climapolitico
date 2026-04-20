ALTER TABLE public.candidate_metrics_cache REPLICA IDENTITY FULL;
ALTER TABLE public.social_interactions REPLICA IDENTITY FULL;
ALTER TABLE public.candidates REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'candidate_metrics_cache'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.candidate_metrics_cache;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'social_interactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.social_interactions;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'candidates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates;
  END IF;
END $$;