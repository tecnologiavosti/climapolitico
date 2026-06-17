ALTER TABLE public.historical_social_mentions
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS interactions integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mention_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS themes jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS source_key text;

UPDATE public.historical_social_mentions
SET
  source_url = COALESCE(source_url, url),
  source_name = COALESCE(source_name, source),
  interactions = COALESCE(interactions, engagement, 0),
  mention_date = COALESCE(mention_date, date),
  themes = COALESCE(themes, topics, '[]'::jsonb),
  source_key = COALESCE(source_key, md5(coalesce(url, title, content, '') || '|' || coalesce(source, '') || '|' || coalesce(candidate_name_normalized, '')))
WHERE source_url IS NULL
   OR source_name IS NULL
   OR mention_date IS NULL
   OR themes IS NULL
   OR source_key IS NULL;

ALTER TABLE public.historical_social_collector_runs
  ADD COLUMN IF NOT EXISTS job_id uuid,
  ADD COLUMN IF NOT EXISTS current_chunk integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_chunks integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mentions_found integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completed_at timestamp with time zone;

UPDATE public.historical_social_collector_runs
SET
  job_id = COALESCE(job_id, id),
  mentions_found = COALESCE(mentions_found, inserted_count, 0),
  completed_at = COALESCE(completed_at, finished_at)
WHERE job_id IS NULL OR completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS historical_social_mentions_source_key_idx
  ON public.historical_social_mentions (candidate_name_normalized, source_key);

CREATE INDEX IF NOT EXISTS historical_social_mentions_lookup_v2_idx
  ON public.historical_social_mentions (candidate_name_normalized, network, mention_date DESC);

CREATE INDEX IF NOT EXISTS historical_social_collector_runs_progress_idx
  ON public.historical_social_collector_runs (candidate_id, candidate_name, status, created_at DESC);