
CREATE OR REPLACE FUNCTION public.reactivate_youtube_keys()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.youtube_api_keys
  SET is_active = true,
      quota_exceeded_count = 0
  WHERE is_active = false
    AND (
      -- Cooldown curto: 3h após qualquer exaustão
      last_quota_exceeded_at < now() - interval '3 hours'
      -- Reset diário do Google: meia-noite horário do Pacífico
      OR (last_quota_exceeded_at AT TIME ZONE 'America/Los_Angeles')::date
         < (now()              AT TIME ZONE 'America/Los_Angeles')::date
    );
$function$;

CREATE OR REPLACE FUNCTION public.youtube_key_stats()
RETURNS TABLE (
  id uuid,
  label text,
  is_active boolean,
  quota_exceeded_count integer,
  last_used_at timestamptz,
  last_quota_exceeded_at timestamptz,
  hours_since_exceeded numeric,
  next_reset_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    k.id,
    k.label,
    k.is_active,
    k.quota_exceeded_count,
    k.last_used_at,
    k.last_quota_exceeded_at,
    CASE WHEN k.last_quota_exceeded_at IS NULL THEN NULL
         ELSE ROUND(EXTRACT(EPOCH FROM (now() - k.last_quota_exceeded_at))/3600, 2)
    END AS hours_since_exceeded,
    -- Próximo reset = próxima meia-noite PT
    (date_trunc('day', (now() AT TIME ZONE 'America/Los_Angeles'))
       + interval '1 day') AT TIME ZONE 'America/Los_Angeles' AS next_reset_at
  FROM public.youtube_api_keys k
  ORDER BY k.is_active DESC, k.last_used_at NULLS FIRST;
$function$;

REVOKE EXECUTE ON FUNCTION public.youtube_key_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.youtube_key_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reactivate_youtube_keys() TO service_role;
