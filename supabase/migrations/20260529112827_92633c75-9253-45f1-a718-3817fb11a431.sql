ALTER TABLE public.political_events 
ADD COLUMN IF NOT EXISTS low_coverage boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS confidence_score numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS importance_score numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS distinct_outlets integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS publications_count integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS themes text[] NOT NULL DEFAULT '{}',
ADD COLUMN IF NOT EXISTS narratives jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_political_events_low_coverage ON public.political_events(low_coverage);
CREATE INDEX IF NOT EXISTS idx_political_events_candidate_date ON public.political_events(candidate_id, event_date DESC);