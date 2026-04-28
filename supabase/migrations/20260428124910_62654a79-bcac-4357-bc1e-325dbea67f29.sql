-- Add region column to social_interactions for regional analysis
ALTER TABLE public.social_interactions
ADD COLUMN IF NOT EXISTS region TEXT;

-- Add a CHECK-style validation via trigger to keep region values constrained
CREATE OR REPLACE FUNCTION public.validate_social_interaction_region()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.region IS NOT NULL AND NEW.region NOT IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul','Indefinido') THEN
    RAISE EXCEPTION 'Invalid region value: %', NEW.region;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_si_region ON public.social_interactions;
CREATE TRIGGER trg_validate_si_region
BEFORE INSERT OR UPDATE ON public.social_interactions
FOR EACH ROW EXECUTE FUNCTION public.validate_social_interaction_region();

-- Index for fast filtering by region + candidate + network
CREATE INDEX IF NOT EXISTS idx_social_interactions_region
  ON public.social_interactions (candidate_id, social_network, region)
  WHERE region IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_social_interactions_region_null
  ON public.social_interactions (candidate_id)
  WHERE region IS NULL;