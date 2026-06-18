
-- system_settings (key/value JSON)
CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  description TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.system_settings TO authenticated, anon;
GRANT ALL ON public.system_settings TO service_role;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can read system settings" ON public.system_settings FOR SELECT USING (true);
CREATE POLICY "Admins manage settings" ON public.system_settings FOR ALL TO authenticated
  USING (public.has_admin_access(auth.uid())) WITH CHECK (public.has_admin_access(auth.uid()));

INSERT INTO public.system_settings (key, value, description) VALUES
  ('platform', '{"name":"Clima Político","logo_url":null,"primary_color":"#0EA5E9","support_email":"contato@climapolitico.com.br"}'::jsonb, 'Configurações da plataforma'),
  ('maintenance', '{"enabled":false,"message":"Voltamos em breve"}'::jsonb, 'Modo manutenção'),
  ('banner', '{"enabled":false,"message":"","variant":"info"}'::jsonb, 'Banner global'),
  ('features', '{"ai_enabled":true,"payments_enabled":true,"radar_enabled":true,"network_view_enabled":true}'::jsonb, 'Feature flags')
ON CONFLICT (key) DO NOTHING;

-- IP bans
CREATE TABLE IF NOT EXISTS public.ip_bans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address INET NOT NULL UNIQUE,
  reason TEXT,
  banned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ip_bans TO authenticated;
GRANT ALL ON public.ip_bans TO service_role;
ALTER TABLE public.ip_bans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ip bans" ON public.ip_bans FOR ALL TO authenticated
  USING (public.has_admin_access(auth.uid())) WITH CHECK (public.has_admin_access(auth.uid()));

-- Blocked emails
CREATE TABLE IF NOT EXISTS public.blocked_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  reason TEXT,
  blocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_emails TO authenticated;
GRANT ALL ON public.blocked_emails TO service_role;
ALTER TABLE public.blocked_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage blocked emails" ON public.blocked_emails FOR ALL TO authenticated
  USING (public.has_admin_access(auth.uid())) WITH CHECK (public.has_admin_access(auth.uid()));

-- Login attempts
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  user_id UUID,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.login_attempts TO authenticated;
GRANT ALL ON public.login_attempts TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins view login attempts" ON public.login_attempts FOR SELECT TO authenticated
  USING (public.has_admin_access(auth.uid()));
CREATE POLICY "Anyone can log attempts" ON public.login_attempts FOR INSERT TO authenticated, anon WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON public.login_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email);
