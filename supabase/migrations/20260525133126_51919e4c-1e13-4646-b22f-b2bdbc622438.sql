
CREATE TABLE IF NOT EXISTS public.event_detection_jobs (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing',
  params JSONB DEFAULT '{}'::jsonb,
  result JSONB,
  events_created INTEGER DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.event_detection_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own event detection jobs"
ON public.event_detection_jobs FOR SELECT
USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_event_detection_jobs_user_created
ON public.event_detection_jobs(user_id, created_at DESC);
