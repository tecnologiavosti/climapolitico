CREATE OR REPLACE FUNCTION public.reprocess_social_interactions_political_validation(_batch_size integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  updated_count integer := 0;
  remaining_count integer := 0;
BEGIN
  WITH batch AS (
    SELECT id
    FROM public.social_interactions
    WHERE political_validation_reason IS NULL
       OR (political_relevance_score = 0 AND is_political_content = true)
    ORDER BY created_at DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(_batch_size, 5000), 20000))
  ), upd AS (
    UPDATE public.social_interactions si
    SET comment_text = si.comment_text
    FROM batch
    WHERE si.id = batch.id
    RETURNING si.id
  )
  SELECT count(*) INTO updated_count FROM upd;

  SELECT count(*) INTO remaining_count
  FROM public.social_interactions
  WHERE political_validation_reason IS NULL
     OR (political_relevance_score = 0 AND is_political_content = true);

  RETURN jsonb_build_object(
    'updated', updated_count,
    'remaining', remaining_count
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reprocess_social_interactions_political_validation(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprocess_social_interactions_political_validation(integer) TO authenticated, service_role;