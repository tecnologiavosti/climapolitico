
-- Índice para acelerar dedup de comentários (trigger skip_duplicate_social_interaction)
CREATE INDEX IF NOT EXISTS idx_social_interactions_dedup
  ON public.social_interactions (candidate_id, social_network, (md5(lower(trim(comment_text)))));

-- Índice para acelerar buscas por data de coleta (dashboards)
CREATE INDEX IF NOT EXISTS idx_social_interactions_collected_at
  ON public.social_interactions (candidate_id, collected_at DESC);

-- Tabela de controle de quota por coletor
CREATE TABLE IF NOT EXISTS public.collector_quota_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_name text NOT NULL UNIQUE,
  daily_calls integer NOT NULL DEFAULT 0,
  daily_errors integer NOT NULL DEFAULT 0,
  daily_items_collected integer NOT NULL DEFAULT 0,
  max_daily_calls integer NOT NULL DEFAULT 10000,
  paused_until timestamptz,
  last_call_at timestamptz,
  last_reset_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.collector_quota_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage quota state"
  ON public.collector_quota_state FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_quota_state_updated
  BEFORE UPDATE ON public.collector_quota_state
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Seed dos coletores conhecidos
INSERT INTO public.collector_quota_state (collector_name, max_daily_calls, notes) VALUES
  ('youtube',      8000,  'YouTube Data API v3 — 10k unidades/key/dia, com rotação'),
  ('twitter',      20000, 'Nitter/Bluesky/Mastodon scraping (sem quota oficial)'),
  ('reddit',       15000, 'PullPush + Arctic Shift (sem quota oficial)'),
  ('telegram',     20000, 'RSSHub/RSS-Bridge scraping'),
  ('tiktok',       5000,  'Scraping TikTok público (rate-limit moderado)'),
  ('google_news',  10000, 'Google News RSS (sem quota oficial)'),
  ('gdelt',        5000,  'GDELT DOC API (sem quota oficial, ~10 req/sec)'),
  ('wikipedia',    1000,  'Wikipedia API (alto limite oficial)'),
  ('meta',         50,    'Apify (PAGO) — limitado para preservar créditos')
ON CONFLICT (collector_name) DO NOTHING;

-- Função: deve pular este coletor agora?
CREATE OR REPLACE FUNCTION public.should_skip_collector(_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.collector_quota_state%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.collector_quota_state WHERE collector_name = _name;
  IF NOT FOUND THEN
    -- Cria entrada padrão e permite executar
    INSERT INTO public.collector_quota_state (collector_name) VALUES (_name) ON CONFLICT DO NOTHING;
    RETURN false;
  END IF;

  -- Reset diário automático
  IF s.last_reset_at < (now() - interval '24 hours') THEN
    UPDATE public.collector_quota_state
      SET daily_calls = 0, daily_errors = 0, daily_items_collected = 0,
          last_reset_at = now(), paused_until = NULL
      WHERE collector_name = _name;
    RETURN false;
  END IF;

  -- Pausa explícita
  IF s.paused_until IS NOT NULL AND s.paused_until > now() THEN
    RETURN true;
  END IF;

  -- Estourou limite diário
  IF s.daily_calls >= s.max_daily_calls THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- Função: registrar uma execução do coletor
CREATE OR REPLACE FUNCTION public.record_collector_call(_name text, _items integer DEFAULT 0, _had_error boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.collector_quota_state (collector_name, daily_calls, daily_items_collected, daily_errors, last_call_at)
  VALUES (_name, 1, _items, CASE WHEN _had_error THEN 1 ELSE 0 END, now())
  ON CONFLICT (collector_name) DO UPDATE SET
    daily_calls = public.collector_quota_state.daily_calls + 1,
    daily_items_collected = public.collector_quota_state.daily_items_collected + _items,
    daily_errors = public.collector_quota_state.daily_errors + CASE WHEN _had_error THEN 1 ELSE 0 END,
    last_call_at = now(),
    updated_at = now();
END;
$$;
