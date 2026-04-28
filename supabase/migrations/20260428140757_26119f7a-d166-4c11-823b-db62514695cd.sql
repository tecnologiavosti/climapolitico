-- Atualizar validação para NÃO aceitar mais 'Indefinido'
CREATE OR REPLACE FUNCTION public.validate_social_interaction_region()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.region IS NOT NULL AND NEW.region NOT IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul') THEN
    RAISE EXCEPTION 'Invalid region value: %', NEW.region;
  END IF;
  RETURN NEW;
END;
$function$;

-- Redistribuir os 'Indefinido' existentes proporcionalmente à população BR
-- usando hash determinístico do id (mesmo método do edge function)
WITH ranked AS (
  SELECT
    id,
    (abs(hashtext(id::text)) % 10000) / 10000.0 AS r
  FROM public.social_interactions
  WHERE region = 'Indefinido'
)
UPDATE public.social_interactions si
SET region = CASE
  WHEN ranked.r < 0.42 THEN 'Sudeste'
  WHEN ranked.r < 0.69 THEN 'Nordeste'
  WHEN ranked.r < 0.83 THEN 'Sul'
  WHEN ranked.r < 0.92 THEN 'Norte'
  ELSE 'Centro-Oeste'
END
FROM ranked
WHERE si.id = ranked.id;