
CREATE TABLE IF NOT EXISTS public.political_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  cargo TEXT,
  party TEXT,
  party_number TEXT,
  region TEXT,
  state TEXT,
  city TEXT,
  status TEXT,
  source TEXT DEFAULT 'cache',
  confidence INT DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_catalog_name ON public.political_catalog(normalized_name);
CREATE INDEX IF NOT EXISTS idx_catalog_city ON public.political_catalog(city);
CREATE INDEX IF NOT EXISTS idx_catalog_state ON public.political_catalog(state);
CREATE INDEX IF NOT EXISTS idx_catalog_cargo ON public.political_catalog(cargo);

GRANT SELECT ON public.political_catalog TO authenticated, anon;
GRANT ALL ON public.political_catalog TO service_role;

ALTER TABLE public.political_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Catalog is readable by everyone"
  ON public.political_catalog FOR SELECT
  USING (true);

CREATE POLICY "Only service role can modify catalog"
  ON public.political_catalog FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_political_catalog_updated_at
  BEFORE UPDATE ON public.political_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
