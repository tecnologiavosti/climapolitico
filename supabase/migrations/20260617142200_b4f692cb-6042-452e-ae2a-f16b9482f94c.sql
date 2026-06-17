CREATE TABLE public.social_analytics_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id text NOT NULL,
  candidate_name text NOT NULL,
  network text NOT NULL DEFAULT 'all',
  period_start date NOT NULL,
  period_end date NOT NULL,
  cache_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  stage text NOT NULL DEFAULT 'Aguardando processamento',
  result jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  force_refresh boolean NOT NULL DEFAULT false,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.social_analytics_jobs TO authenticated;
GRANT ALL ON public.social_analytics_jobs TO service_role;

ALTER TABLE public.social_analytics_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own social analytics jobs"
ON public.social_analytics_jobs
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX idx_social_analytics_jobs_user_created
ON public.social_analytics_jobs (user_id, created_at DESC);

CREATE INDEX idx_social_analytics_jobs_active_key
ON public.social_analytics_jobs (user_id, cache_key, status, created_at DESC);

CREATE TABLE public.social_analytics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  candidate_id text NOT NULL,
  network text NOT NULL DEFAULT 'all',
  period_start date NOT NULL,
  period_end date NOT NULL,
  result jsonb NOT NULL,
  source_job_id uuid REFERENCES public.social_analytics_jobs(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.social_analytics_cache TO service_role;

ALTER TABLE public.social_analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_social_analytics_cache_expires
ON public.social_analytics_cache (cache_key, expires_at DESC);

CREATE OR REPLACE FUNCTION public.update_social_analytics_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_social_analytics_jobs_updated_at
BEFORE UPDATE ON public.social_analytics_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_social_analytics_updated_at();

CREATE TRIGGER update_social_analytics_cache_updated_at
BEFORE UPDATE ON public.social_analytics_cache
FOR EACH ROW
EXECUTE FUNCTION public.update_social_analytics_updated_at();