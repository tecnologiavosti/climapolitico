
-- Função utilitária (idempotente)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =========================================================================
-- 1) source_registry
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.source_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name TEXT NOT NULL UNIQUE,
  source_domain TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('institutional','major_news','news','aggregator','social')),
  credibility_weight NUMERIC(3,2) NOT NULL DEFAULT 0.50 CHECK (credibility_weight >= 0 AND credibility_weight <= 1),
  rss_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.source_registry TO authenticated;
GRANT ALL ON public.source_registry TO service_role;

ALTER TABLE public.source_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "source_registry readable by authenticated" ON public.source_registry;
CREATE POLICY "source_registry readable by authenticated"
  ON public.source_registry FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "source_registry managed by admins" ON public.source_registry;
CREATE POLICY "source_registry managed by admins"
  ON public.source_registry FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_source_registry_type ON public.source_registry(source_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_source_registry_domain ON public.source_registry(source_domain);

DROP TRIGGER IF EXISTS trg_source_registry_updated_at ON public.source_registry;
CREATE TRIGGER trg_source_registry_updated_at
  BEFORE UPDATE ON public.source_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- 2) event_sources
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.event_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.political_events(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('institutional','major_news','news','aggregator','social')),
  url TEXT NOT NULL,
  title TEXT,
  snippet TEXT,
  published_at TIMESTAMPTZ,
  credibility_score NUMERIC(3,2) NOT NULL DEFAULT 0.50,
  is_institutional BOOLEAN NOT NULL DEFAULT false,
  is_major_media BOOLEAN NOT NULL DEFAULT false,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_sources TO authenticated;
GRANT ALL ON public.event_sources TO service_role;

ALTER TABLE public.event_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "event_sources visible to event owner" ON public.event_sources;
CREATE POLICY "event_sources visible to event owner"
  ON public.event_sources FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = event_sources.event_id AND pe.user_id = auth.uid()));

DROP POLICY IF EXISTS "event_sources mutated by event owner" ON public.event_sources;
CREATE POLICY "event_sources mutated by event owner"
  ON public.event_sources FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = event_sources.event_id AND pe.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = event_sources.event_id AND pe.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_event_sources_event ON public.event_sources(event_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_published ON public.event_sources(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_sources_institutional ON public.event_sources(event_id) WHERE is_institutional;

-- =========================================================================
-- 3) social_event_metrics
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.social_event_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.political_events(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  mentions INTEGER NOT NULL DEFAULT 0,
  engagement BIGINT NOT NULL DEFAULT 0,
  unique_authors INTEGER NOT NULL DEFAULT 0,
  velocity NUMERIC(10,2) NOT NULL DEFAULT 0,
  sentiment_avg NUMERIC(5,2),
  polarization NUMERIC(4,3),
  window_start TIMESTAMPTZ,
  window_end TIMESTAMPTZ,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, platform)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_event_metrics TO authenticated;
GRANT ALL ON public.social_event_metrics TO service_role;

ALTER TABLE public.social_event_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "social_event_metrics visible to event owner" ON public.social_event_metrics;
CREATE POLICY "social_event_metrics visible to event owner"
  ON public.social_event_metrics FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = social_event_metrics.event_id AND pe.user_id = auth.uid()));

DROP POLICY IF EXISTS "social_event_metrics mutated by event owner" ON public.social_event_metrics;
CREATE POLICY "social_event_metrics mutated by event owner"
  ON public.social_event_metrics FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = social_event_metrics.event_id AND pe.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.political_events pe WHERE pe.id = social_event_metrics.event_id AND pe.user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_social_event_metrics_event ON public.social_event_metrics(event_id);

-- =========================================================================
-- 4) Expansão de political_events
-- =========================================================================
ALTER TABLE public.political_events
  ADD COLUMN IF NOT EXISTS title_canonical TEXT,
  ADD COLUMN IF NOT EXISTS category_v2 TEXT,
  ADD COLUMN IF NOT EXISTS confidence_level TEXT,
  ADD COLUMN IF NOT EXISTS relevance_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS event_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS social_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS start_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS peak_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS total_sources INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS institutional_sources INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS major_media_sources INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_social_only BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_summary_v2 TEXT,
  ADD COLUMN IF NOT EXISTS ai_impact TEXT,
  ADD COLUMN IF NOT EXISTS detection_source TEXT;

DO $$ BEGIN
  ALTER TABLE public.political_events
    ADD CONSTRAINT political_events_category_v2_check
    CHECK (category_v2 IS NULL OR category_v2 IN (
      'eleicoes','debate','tse','stf','pf','cpi','congresso','executivo',
      'economia','escandalo','prisao','julgamento','internacional','outros'
    ));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.political_events
    ADD CONSTRAINT political_events_confidence_level_check
    CHECK (confidence_level IS NULL OR confidence_level IN ('confirmed','probable','weak','noise'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_political_events_cand_conf_peak
  ON public.political_events(candidate_id, confidence_level, peak_date DESC);
CREATE INDEX IF NOT EXISTS idx_political_events_category_v2
  ON public.political_events(category_v2) WHERE category_v2 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_political_events_not_social_only
  ON public.political_events(candidate_id, peak_date DESC) WHERE is_social_only = false;

-- =========================================================================
-- 5) Seed do source_registry
-- =========================================================================
INSERT INTO public.source_registry (source_name, source_domain, source_type, credibility_weight, rss_url) VALUES
  ('STF', 'stf.jus.br', 'institutional', 1.00, 'https://noticias.stf.jus.br/postsnoticias/feed/'),
  ('TSE', 'tse.jus.br', 'institutional', 1.00, 'https://www.tse.jus.br/comunicacao/noticias/feed'),
  ('Senado Federal', 'senado.leg.br', 'institutional', 0.95, 'https://www12.senado.leg.br/noticias/ultimas/feed'),
  ('Câmara dos Deputados', 'camara.leg.br', 'institutional', 0.95, 'https://www.camara.leg.br/noticias/rss/ultimas'),
  ('Planalto', 'gov.br/planalto', 'institutional', 0.95, NULL),
  ('Polícia Federal', 'gov.br/pf', 'institutional', 0.95, NULL),
  ('CGU', 'gov.br/cgu', 'institutional', 0.90, NULL),
  ('TCU', 'tcu.gov.br', 'institutional', 0.90, NULL),
  ('Ministério da Justiça', 'gov.br/mj', 'institutional', 0.90, NULL),
  ('Banco Central', 'bcb.gov.br', 'institutional', 0.90, NULL),
  ('Diário Oficial', 'in.gov.br', 'institutional', 0.95, NULL),
  ('G1', 'g1.globo.com', 'major_news', 0.90, 'https://g1.globo.com/rss/g1/politica/'),
  ('Folha de S.Paulo', 'folha.uol.com.br', 'major_news', 0.90, 'https://feeds.folha.uol.com.br/poder/rss091.xml'),
  ('Estadão', 'estadao.com.br', 'major_news', 0.90, NULL),
  ('UOL', 'uol.com.br', 'major_news', 0.85, 'https://rss.uol.com.br/feed/politica.xml'),
  ('CNN Brasil', 'cnnbrasil.com.br', 'major_news', 0.85, 'https://www.cnnbrasil.com.br/politica/feed/'),
  ('Poder360', 'poder360.com.br', 'major_news', 0.85, 'https://www.poder360.com.br/feed/'),
  ('Metrópoles', 'metropoles.com', 'major_news', 0.80, 'https://www.metropoles.com/feed'),
  ('CartaCapital', 'cartacapital.com.br', 'major_news', 0.80, 'https://www.cartacapital.com.br/feed/'),
  ('Veja', 'veja.abril.com.br', 'major_news', 0.85, 'https://veja.abril.com.br/feed'),
  ('Reuters Brasil', 'reuters.com', 'major_news', 0.95, NULL),
  ('Agência Brasil', 'agenciabrasil.ebc.com.br', 'major_news', 0.90, 'https://agenciabrasil.ebc.com.br/rss/politica/feed.xml'),
  ('Valor Econômico', 'valor.globo.com', 'major_news', 0.90, NULL),
  ('O Globo', 'oglobo.globo.com', 'major_news', 0.90, NULL),
  ('GloboNews', 'g1.globo.com/globonews', 'major_news', 0.90, NULL),
  ('Google News', 'news.google.com', 'aggregator', 0.70, NULL),
  ('GDELT', 'gdeltproject.org', 'aggregator', 0.70, NULL),
  ('EventRegistry', 'eventregistry.org', 'aggregator', 0.70, NULL),
  ('Bing News', 'bing.com/news', 'aggregator', 0.65, NULL)
ON CONFLICT (source_name) DO UPDATE SET
  source_domain = EXCLUDED.source_domain,
  source_type = EXCLUDED.source_type,
  credibility_weight = EXCLUDED.credibility_weight,
  rss_url = COALESCE(EXCLUDED.rss_url, public.source_registry.rss_url),
  updated_at = now();
