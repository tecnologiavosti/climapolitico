ALTER TABLE public.political_events
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS ai_cause TEXT,
  ADD COLUMN IF NOT EXISTS ai_why_peak TEXT,
  ADD COLUMN IF NOT EXISTS ai_sentiment NUMERIC,
  ADD COLUMN IF NOT EXISTS evidence_quality TEXT,
  ADD COLUMN IF NOT EXISTS significance_score NUMERIC;

CREATE INDEX IF NOT EXISTS political_events_category_date_idx
  ON public.political_events (category, event_date DESC);
CREATE INDEX IF NOT EXISTS political_events_confidence_band_idx
  ON public.political_events (confidence_band, event_date DESC);