
CREATE TABLE public.radar_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id UUID,
  candidate_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  total_chunks INTEGER NOT NULL DEFAULT 0,
  processed_chunks INTEGER NOT NULL DEFAULT 0,
  events_count INTEGER NOT NULL DEFAULT 0,
  events JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_radar_jobs_user ON public.radar_jobs(user_id, created_at DESC);
CREATE INDEX idx_radar_jobs_status ON public.radar_jobs(status, created_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_jobs TO authenticated;
GRANT ALL ON public.radar_jobs TO service_role;

ALTER TABLE public.radar_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own radar jobs"
  ON public.radar_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_radar_jobs_updated_at
  BEFORE UPDATE ON public.radar_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
