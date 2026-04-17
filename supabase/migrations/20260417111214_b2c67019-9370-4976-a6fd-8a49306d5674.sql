
-- 1. Catálogo público de candidatos (compartilhado entre todos os clientes)
CREATE TABLE public.public_candidates_catalog (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  party TEXT,
  region TEXT,
  social_media_link TEXT,
  description TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.public_candidates_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone authenticated can view public catalog"
ON public.public_candidates_catalog FOR SELECT
TO authenticated
USING (is_active = true);

CREATE POLICY "Admins can manage public catalog"
ON public.public_candidates_catalog FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_public_catalog_updated_at
BEFORE UPDATE ON public.public_candidates_catalog
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 2. Adicionar colunas de preferências em profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'pt-BR',
  ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light',
  ADD COLUMN IF NOT EXISTS party TEXT,
  ADD COLUMN IF NOT EXISTS party_visible BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN NOT NULL DEFAULT false;

-- Permitir que usuários insiram seu próprio profile (faltava)
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- 3. Tabela de códigos OTP para 2FA por email
CREATE TABLE public.email_otp_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'login_2fa',
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_otp_user ON public.email_otp_codes(user_id, purpose, expires_at DESC);

ALTER TABLE public.email_otp_codes ENABLE ROW LEVEL SECURITY;

-- Apenas o próprio usuário pode visualizar metadados (não o hash) — mas mesmo assim só usado server-side
CREATE POLICY "Deny all client access to OTP codes"
ON public.email_otp_codes FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- 4. Storage bucket público para avatares
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can view avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own avatar"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
