
CREATE TABLE IF NOT EXISTS public.regional_analytics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('region','state')),
  region text,
  state text,
  mentions integer NOT NULL DEFAULT 0,
  positive integer NOT NULL DEFAULT 0,
  negative integer NOT NULL DEFAULT 0,
  neutral integer NOT NULL DEFAULT 0,
  avg_engagement numeric NOT NULL DEFAULT 0,
  network_distribution jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS regional_analytics_cache_unique_key
  ON public.regional_analytics_cache (
    user_id, candidate_id, scope, coalesce(region,''), coalesce(state,'')
  );

CREATE INDEX IF NOT EXISTS regional_analytics_cache_candidate_idx
  ON public.regional_analytics_cache (candidate_id, scope);

GRANT SELECT ON public.regional_analytics_cache TO authenticated;
GRANT ALL ON public.regional_analytics_cache TO service_role;

ALTER TABLE public.regional_analytics_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own regional cache"
  ON public.regional_analytics_cache
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role manages regional cache"
  ON public.regional_analytics_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER trg_regional_analytics_cache_updated
  BEFORE UPDATE ON public.regional_analytics_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
