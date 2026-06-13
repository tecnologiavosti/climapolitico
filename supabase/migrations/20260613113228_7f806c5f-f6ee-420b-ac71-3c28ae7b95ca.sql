
CREATE TABLE IF NOT EXISTS public.radar_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id uuid,
  candidate_name text NOT NULL,
  period_hash text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  categories text[] NOT NULL DEFAULT '{}',
  response_json jsonb NOT NULL,
  event_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '6 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS radar_cache_unique_key
  ON public.radar_cache (user_id, period_hash);

CREATE INDEX IF NOT EXISTS radar_cache_expires_idx
  ON public.radar_cache (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.radar_cache TO authenticated;
GRANT ALL ON public.radar_cache TO service_role;

ALTER TABLE public.radar_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "radar_cache_owner_all" ON public.radar_cache
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
