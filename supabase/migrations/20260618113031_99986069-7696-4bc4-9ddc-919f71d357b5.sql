
-- subscription_plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL UNIQUE,
  display_name text NOT NULL,
  price_monthly numeric NOT NULL DEFAULT 0,
  price_yearly numeric NOT NULL DEFAULT 0,
  max_candidates integer NOT NULL DEFAULT 1,
  max_updates_per_month integer NOT NULL DEFAULT 10,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO anon, authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read plans" ON public.subscription_plans;
CREATE POLICY "Anyone can read plans" ON public.subscription_plans FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage plans" ON public.subscription_plans;
CREATE POLICY "Admins manage plans" ON public.subscription_plans FOR ALL
  TO authenticated
  USING (public.has_admin_access(auth.uid()))
  WITH CHECK (public.has_admin_access(auth.uid()));

INSERT INTO public.subscription_plans (tier, display_name, price_monthly, price_yearly, max_candidates, max_updates_per_month, features, sort_order)
VALUES
  ('free', 'Free', 0, 0, 1, 10, '["Painel básico","Sem alertas"]'::jsonb, 1),
  ('pro', 'Pro', 49, 490, 5, 100, '["Alertas","Relatórios PDF","Histórico 90d"]'::jsonb, 2),
  ('enterprise', 'Enterprise', 199, 1990, 25, 1000, '["Multi-usuário","API","SLA"]'::jsonb, 3),
  ('lifetime', 'Vitalício', 0, 0, 9999, 9999, '["Acesso vitalício","Todos os recursos"]'::jsonb, 4)
ON CONFLICT (tier) DO NOTHING;

-- seo_settings
CREATE TABLE IF NOT EXISTS public.seo_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL UNIQUE,
  title text,
  description text,
  keywords text,
  og_image text,
  og_title text,
  og_description text,
  canonical_url text,
  schema_jsonld jsonb,
  noindex boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.seo_settings TO anon, authenticated;
GRANT ALL ON public.seo_settings TO service_role;

ALTER TABLE public.seo_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read seo" ON public.seo_settings;
CREATE POLICY "Anyone can read seo" ON public.seo_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage seo" ON public.seo_settings;
CREATE POLICY "Admins manage seo" ON public.seo_settings FOR ALL
  TO authenticated
  USING (public.has_admin_access(auth.uid()))
  WITH CHECK (public.has_admin_access(auth.uid()));

INSERT INTO public.seo_settings (route, title, description, keywords)
VALUES
  ('/', 'Clima Político — Monitoramento Político em Tempo Real', 'Plataforma de inteligência política: monitoramento, sentimento, radar e análises por IA.', 'monitoramento político, sentimento, radar político, IA política'),
  ('/dashboard', 'Painel · Clima Político', 'Painel de monitoramento político em tempo real.', 'painel, dashboard'),
  ('/auth', 'Entrar · Clima Político', 'Acesse sua conta no Clima Político.', 'login, entrar')
ON CONFLICT (route) DO NOTHING;

-- Promote existing admin emails to super_admin
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'super_admin'::public.app_role
FROM auth.users u
WHERE u.email IN ('contatojasonti@gmail.com','jasontralli@gmail.com','empresaswgm@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_subscription_plans_updated ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_seo_settings_updated ON public.seo_settings;
CREATE TRIGGER trg_seo_settings_updated BEFORE UPDATE ON public.seo_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
