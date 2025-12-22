-- Create table for API configurations
CREATE TABLE public.api_configurations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL UNIQUE, -- 'twitter', 'youtube', 'meta', 'tiktok', 'reddit'
  api_key TEXT, -- Encrypted/stored key
  api_secret TEXT, -- Optional secondary key
  access_token TEXT, -- Optional access token
  is_active BOOLEAN DEFAULT false,
  last_verified_at TIMESTAMPTZ,
  verified_status TEXT DEFAULT 'pending', -- 'valid', 'invalid', 'expired', 'pending'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.api_configurations ENABLE ROW LEVEL SECURITY;

-- Only admins can view API configurations
CREATE POLICY "Admins can view API configs"
ON public.api_configurations
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can insert API configurations
CREATE POLICY "Admins can insert API configs"
ON public.api_configurations
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Only admins can update API configurations
CREATE POLICY "Admins can update API configs"
ON public.api_configurations
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Only admins can delete API configurations
CREATE POLICY "Admins can delete API configs"
ON public.api_configurations
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Create trigger for updated_at
CREATE TRIGGER update_api_configurations_updated_at
BEFORE UPDATE ON public.api_configurations
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();