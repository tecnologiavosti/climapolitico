CREATE OR REPLACE FUNCTION public.create_api_key(
  _name text,
  _scopes text[] DEFAULT ARRAY['read:candidates','read:analyses','read:usage'],
  _expires_days integer DEFAULT NULL,
  _rate_limit_per_minute integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _raw text;
  _token text;
  _hash text;
  _prefix text;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF length(coalesce(_name,'')) = 0 THEN
    RAISE EXCEPTION 'name_required';
  END IF;

  _raw := encode(extensions.gen_random_bytes(24), 'hex');
  _token := 'pk_live_' || _raw;
  _hash := encode(extensions.digest(_token, 'sha256'), 'hex');
  _prefix := substr(_token, 1, 14);

  INSERT INTO public.api_keys(user_id, name, key_prefix, key_hash, scopes, rate_limit_per_minute, expires_at)
  VALUES (
    _uid,
    _name,
    _prefix,
    _hash,
    _scopes,
    greatest(1, least(6000, _rate_limit_per_minute)),
    CASE WHEN _expires_days IS NULL THEN NULL ELSE now() + (_expires_days || ' days')::interval END
  )
  RETURNING id INTO _id;

  RETURN jsonb_build_object('id', _id, 'token', _token, 'prefix', _prefix);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_api_key(text, text[], integer, integer) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.create_api_key(text, text[], integer, integer) TO authenticated;