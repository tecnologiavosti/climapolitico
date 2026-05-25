-- ============================================================
-- FASE 1: NOVA ARQUITETURA DE DADOS
-- ============================================================

-- 1) political_events: eventos cadastrados pelo usuário (entrevistas, debates, etc.)
CREATE TABLE IF NOT EXISTS public.political_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  event_name TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL DEFAULT 'entrevista',
  event_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  city TEXT,
  state TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_political_events_user ON public.political_events(user_id);
CREATE INDEX IF NOT EXISTS idx_political_events_candidate ON public.political_events(candidate_id);
CREATE INDEX IF NOT EXISTS idx_political_events_date ON public.political_events(event_date DESC);

ALTER TABLE public.political_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own events" ON public.political_events
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users insert own events" ON public.political_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own events" ON public.political_events
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own events" ON public.political_events
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER trg_political_events_updated_at
  BEFORE UPDATE ON public.political_events
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2) narrative_alerts: alertas de narrativa gerados pela IA
CREATE TABLE IF NOT EXISTS public.narrative_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  trigger_reason TEXT NOT NULL,
  detected_bubble TEXT,
  dominant_theme TEXT,
  affected_groups JSONB NOT NULL DEFAULT '[]'::jsonb,
  dominant_sentiment TEXT,
  suggested_action TEXT,
  alternative_narrative TEXT,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  opportunities JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence NUMERIC(5,2),
  spike_volume INTEGER DEFAULT 0,
  region TEXT,
  is_dismissed BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_narrative_alerts_user ON public.narrative_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_narrative_alerts_candidate ON public.narrative_alerts(candidate_id);
CREATE INDEX IF NOT EXISTS idx_narrative_alerts_created ON public.narrative_alerts(created_at DESC);

ALTER TABLE public.narrative_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own narrative alerts" ON public.narrative_alerts
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users insert own narrative alerts" ON public.narrative_alerts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own narrative alerts" ON public.narrative_alerts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own narrative alerts" ON public.narrative_alerts
  FOR DELETE USING (auth.uid() = user_id);

-- 3) historical_metrics: snapshot diário de métricas por candidato
CREATE TABLE IF NOT EXISTS public.historical_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  metric_date DATE NOT NULL,
  mentions INTEGER NOT NULL DEFAULT 0,
  engagement INTEGER NOT NULL DEFAULT 0,
  positive_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  average_sentiment NUMERIC(5,2),
  top_topics JSONB NOT NULL DEFAULT '[]'::jsonb,
  network_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  region_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_source TEXT NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(candidate_id, metric_date, data_source)
);

CREATE INDEX IF NOT EXISTS idx_historical_metrics_user ON public.historical_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_historical_metrics_candidate_date ON public.historical_metrics(candidate_id, metric_date DESC);

ALTER TABLE public.historical_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own historical metrics" ON public.historical_metrics
  FOR SELECT USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users insert own historical metrics" ON public.historical_metrics
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own historical metrics" ON public.historical_metrics
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own historical metrics" ON public.historical_metrics
  FOR DELETE USING (auth.uid() = user_id);

-- 4) Extensões em social_interactions: geo, event link, e árvore de comentários
ALTER TABLE public.social_interactions
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS event_id UUID,
  ADD COLUMN IF NOT EXISTS root_comment_id UUID,
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID,
  ADD COLUMN IF NOT EXISTS post_id TEXT,
  ADD COLUMN IF NOT EXISTS external_id TEXT;

CREATE INDEX IF NOT EXISTS idx_social_interactions_state ON public.social_interactions(state) WHERE state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_city ON public.social_interactions(city) WHERE city IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_event ON public.social_interactions(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_root ON public.social_interactions(root_comment_id) WHERE root_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_parent ON public.social_interactions(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_interactions_post ON public.social_interactions(post_id) WHERE post_id IS NOT NULL;