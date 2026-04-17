-- Habilitar extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tabela de instâncias Nitter
CREATE TABLE IF NOT EXISTS public.nitter_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked TIMESTAMPTZ,
  health_score INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.nitter_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view active nitter instances"
  ON public.nitter_instances FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can manage nitter instances"
  ON public.nitter_instances FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_nitter_instances_updated_at
  BEFORE UPDATE ON public.nitter_instances
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Seed de instâncias Nitter conhecidas
INSERT INTO public.nitter_instances (url) VALUES
  ('https://xcancel.com'),
  ('https://nitter.privacydev.net'),
  ('https://nitter.poast.org'),
  ('https://nitter.net'),
  ('https://nitter.cz'),
  ('https://nitter.it'),
  ('https://nitter.tiekoetter.com'),
  ('https://nitter.kavin.rocks')
ON CONFLICT (url) DO NOTHING;