-- Tabela de chaves rotativas do YouTube
CREATE TABLE IF NOT EXISTS public.youtube_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key text NOT NULL UNIQUE,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  quota_exceeded_count integer NOT NULL DEFAULT 0,
  last_quota_exceeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.youtube_api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage youtube api keys"
ON public.youtube_api_keys FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_youtube_api_keys_active_lastused
  ON public.youtube_api_keys (is_active, last_used_at NULLS FIRST);

-- Auto-reativar chaves após 24h (reset diário de quota do YouTube é meia-noite PT)
CREATE OR REPLACE FUNCTION public.reactivate_youtube_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.youtube_api_keys
  SET is_active = true
  WHERE is_active = false
    AND last_quota_exceeded_at < now() - interval '24 hours';
$$;

-- Campo de erro recente para Nitter
ALTER TABLE public.nitter_instances 
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_message text;