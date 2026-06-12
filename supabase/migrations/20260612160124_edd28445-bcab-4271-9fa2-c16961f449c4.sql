
ALTER TABLE public.political_events
  ADD COLUMN IF NOT EXISTS cluster_size INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.radar_pipeline_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  year INTEGER NOT NULL,
  events_found INTEGER NOT NULL DEFAULT 0,
  expected_min INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL CHECK (status IN ('OK','WARNING','FAIL')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, year)
);

GRANT SELECT ON public.radar_pipeline_health TO authenticated;
GRANT ALL ON public.radar_pipeline_health TO service_role;

ALTER TABLE public.radar_pipeline_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own radar pipeline health"
  ON public.radar_pipeline_health FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_radar_pipeline_health_cand_year
  ON public.radar_pipeline_health(candidate_id, year);
