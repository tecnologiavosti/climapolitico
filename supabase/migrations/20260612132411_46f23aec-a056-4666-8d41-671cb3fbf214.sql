
ALTER TABLE public.political_events
  ADD COLUMN IF NOT EXISTS confidence_v2 numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confidence_band text NOT NULL DEFAULT 'indeterminate',
  ADD COLUMN IF NOT EXISTS detectors_triggered text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dynamic_threshold numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_diversity_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_authority_avg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cross_platform_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_externally_validated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS institutional_confirmations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS large_media_confirmations integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS validation_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS top_headlines jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS peak_hourly_mentions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS baseline_mentions numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_political_events_candidate_confidence
  ON public.political_events (candidate_id, confidence_v2 DESC);

CREATE INDEX IF NOT EXISTS idx_political_events_band_date
  ON public.political_events (confidence_band, event_date DESC);

CREATE INDEX IF NOT EXISTS idx_political_events_validated
  ON public.political_events (is_externally_validated, event_date DESC)
  WHERE is_externally_validated = true;
