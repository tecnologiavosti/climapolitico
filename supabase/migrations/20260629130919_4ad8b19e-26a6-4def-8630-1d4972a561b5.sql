
-- ===== pre_candidates =====
CREATE TABLE public.pre_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  nome_normalizado text NOT NULL,
  estado text,
  municipio text,
  cargo_sugerido text,
  partido_sugerido text,
  instagram text,
  facebook text,
  tiktok text,
  youtube text,
  mentions_30d integer DEFAULT 0,
  engagement_score numeric DEFAULT 0,
  sentiment_score numeric DEFAULT 0,
  growth_score numeric DEFAULT 0,
  confidence_score numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ai',
  reason text,
  status text NOT NULL DEFAULT 'auto_detected',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pre_candidates_dedupe_idx
  ON public.pre_candidates (
    nome_normalizado,
    COALESCE(estado, ''),
    COALESCE(municipio, ''),
    COALESCE(cargo_sugerido, '')
  );
CREATE INDEX pre_candidates_norm_idx ON public.pre_candidates(nome_normalizado);
CREATE INDEX pre_candidates_loc_idx ON public.pre_candidates(estado, municipio);
CREATE INDEX pre_candidates_conf_idx ON public.pre_candidates(confidence_score DESC);

GRANT SELECT ON public.pre_candidates TO anon, authenticated;
GRANT ALL ON public.pre_candidates TO service_role;

ALTER TABLE public.pre_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pre_candidates_public_read"
  ON public.pre_candidates FOR SELECT
  USING (true);

CREATE POLICY "pre_candidates_service_write"
  ON public.pre_candidates FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Trigger updated_at (reuse existing helper if present)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER pre_candidates_set_updated_at
  BEFORE UPDATE ON public.pre_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== pre_candidate_signals =====
CREATE TABLE public.pre_candidate_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pre_candidate_id uuid REFERENCES public.pre_candidates(id) ON DELETE CASCADE,
  nome_normalizado text NOT NULL,
  source text NOT NULL,
  url text,
  snippet text,
  matched_keywords text[] DEFAULT '{}'::text[],
  collected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pre_candidate_signals_norm_idx ON public.pre_candidate_signals(nome_normalizado);
CREATE INDEX pre_candidate_signals_collected_idx ON public.pre_candidate_signals(collected_at DESC);

GRANT ALL ON public.pre_candidate_signals TO service_role;

ALTER TABLE public.pre_candidate_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pre_candidate_signals_service_only"
  ON public.pre_candidate_signals FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
