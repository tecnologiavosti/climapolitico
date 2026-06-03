CREATE TABLE IF NOT EXISTS public.trending_candidates_cache (
  role text PRIMARY KEY,
  candidate_id uuid REFERENCES public.candidates(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  party text,
  region text,
  photo_url text,
  mentions_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.trending_candidates_cache TO anon;
GRANT SELECT ON public.trending_candidates_cache TO authenticated;
GRANT ALL ON public.trending_candidates_cache TO service_role;

ALTER TABLE public.trending_candidates_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read trending candidates"
  ON public.trending_candidates_cache FOR SELECT
  USING (true);
