
-- Remove o índice estrito (que causaria erros) e usa trigger que apenas ignora
DROP INDEX IF EXISTS public.idx_social_interactions_unique_comment;

-- Recria como índice NÃO-único para acelerar lookups de duplicatas
CREATE INDEX IF NOT EXISTS idx_social_interactions_dedup_lookup
ON public.social_interactions (
  candidate_id,
  social_network,
  md5(lower(trim(comment_text)))
)
WHERE comment_text IS NOT NULL AND length(trim(comment_text)) > 0;

-- Trigger que silenciosamente descarta inserções duplicadas
CREATE OR REPLACE FUNCTION public.skip_duplicate_social_interaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.comment_text IS NULL OR length(trim(NEW.comment_text)) = 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.social_interactions
    WHERE candidate_id = NEW.candidate_id
      AND social_network = NEW.social_network
      AND md5(lower(trim(comment_text))) = md5(lower(trim(NEW.comment_text)))
    LIMIT 1
  ) THEN
    RETURN NULL;  -- descarta o INSERT silenciosamente
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_skip_duplicate_social_interaction ON public.social_interactions;

CREATE TRIGGER trg_skip_duplicate_social_interaction
BEFORE INSERT ON public.social_interactions
FOR EACH ROW
EXECUTE FUNCTION public.skip_duplicate_social_interaction();
