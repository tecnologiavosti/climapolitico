ALTER TABLE public.political_events ADD COLUMN IF NOT EXISTS sources_json jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS idx_political_events_candidate_event_date ON public.political_events (candidate_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_political_events_category ON public.political_events (category);