-- Wave 7: Public API v1 — API keys, rate limiting helpers, usage logging
-- Separate from worker tokens to avoid scope confusion.

CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  key_prefix text NOT NULL,                -- first chars shown to user e.g. "pk_live_abcd"
  key_hash text NOT NULL UNIQUE,           -- sha256 of full key
  scopes text[] NOT NULL DEFAULT ARRAY['read:candidates','read:analyses','read:usage'],
  rate_limit_per_minute integer NOT NULL DEFAULT 60,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash) WHERE revoked_at IS NULL;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own api keys" ON public.api_keys
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all api keys" ON public.api_keys
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Verify API key: returns user_id + scopes if valid
CREATE OR REPLACE FUNCTION public.verify_api_key(_token text, _required_scope text)
RETURNS TABLE(user_id uuid, key_id uuid, rate_limit_per_minute integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _hash text;
BEGIN
  _hash := encode(extensions.digest(_token, 'sha256'), 'hex');
  RETURN QUERY
  UPDATE public.api_keys k
     SET last_used_at = now()
   WHERE k.key_hash = _hash
     AND k.revoked_at IS NULL
     AND (k.expires_at IS NULL OR k.expires_at > now())
     AND _required_scope = ANY(k.scopes)
  RETURNING k.user_id, k.id, k.rate_limit_per_minute;
END;
$$;

-- Simple rate limit check: counts requests in last minute window
CREATE OR REPLACE FUNCTION public.check_api_rate_limit(_key_id uuid, _limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count integer;
BEGIN
  SELECT count(*) INTO _count
    FROM public.usage_events
   WHERE event_type = 'api_request'
     AND (metadata->>'key_id') = _key_id::text
     AND occurred_at > now() - interval '1 minute';
  RETURN _count < _limit;
END;
$$;