
CREATE OR REPLACE FUNCTION public.reprocess_social_interactions_political_validation(_batch_size integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  updated_count integer := 0;
  failed_count  integer := 0;
  remaining_count integer := 0;
  effective_limit integer := greatest(1, least(coalesce(_batch_size, 50), 500));
  failed_ids uuid[] := ARRAY[]::uuid[];
  err_text text;
BEGIN
  FOR r IN
    SELECT id
    FROM public.social_interactions
    WHERE political_validation_reason IS NULL
       OR (political_relevance_score = 0 AND is_political_content = true)
    ORDER BY created_at DESC NULLS LAST
    LIMIT effective_limit
  LOOP
    BEGIN
      RAISE LOG 'reprocess_social_interactions: processing %', r.id;
      UPDATE public.social_interactions si
      SET comment_text = si.comment_text
      WHERE si.id = r.id;
      updated_count := updated_count + 1;
    EXCEPTION WHEN OTHERS THEN
      failed_count := failed_count + 1;
      err_text := SQLERRM;
      failed_ids := array_append(failed_ids, r.id);
      RAISE WARNING 'reprocess_social_interactions: failed % -> %', r.id, err_text;
    END;
  END LOOP;

  RAISE LOG 'reprocess_social_interactions: batch completed updated=% failed=%', updated_count, failed_count;

  SELECT count(*) INTO remaining_count
  FROM public.social_interactions
  WHERE political_validation_reason IS NULL
     OR (political_relevance_score = 0 AND is_political_content = true);

  RETURN jsonb_build_object(
    'updated', updated_count,
    'failed', failed_count,
    'failed_ids', to_jsonb(failed_ids),
    'remaining', remaining_count,
    'batch_size', effective_limit
  );
END;
$function$;
