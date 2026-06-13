CREATE TABLE IF NOT EXISTS public.radar_job_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.radar_jobs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_hash TEXT NOT NULL,
  event_index INTEGER NOT NULL DEFAULT 0,
  event_date DATE,
  importance INTEGER NOT NULL DEFAULT 0,
  event_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_job_events TO authenticated;
GRANT ALL ON public.radar_job_events TO service_role;

ALTER TABLE public.radar_job_events ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS radar_job_events_unique_job_hash
  ON public.radar_job_events (job_id, event_hash);

CREATE INDEX IF NOT EXISTS radar_job_events_job_order_idx
  ON public.radar_job_events (job_id, event_date DESC NULLS LAST, importance DESC);

CREATE INDEX IF NOT EXISTS radar_job_events_user_job_idx
  ON public.radar_job_events (user_id, job_id);

CREATE POLICY "Users manage own radar job events"
  ON public.radar_job_events FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);