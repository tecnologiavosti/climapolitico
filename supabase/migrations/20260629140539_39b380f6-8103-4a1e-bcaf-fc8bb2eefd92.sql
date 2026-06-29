
-- Lifetime candidate quota: deleting candidates does not restore slots.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS candidates_created_total integer NOT NULL DEFAULT 0;

-- Backfill: start the counter from the current active candidate count.
UPDATE public.subscriptions s
SET candidates_created_total = GREATEST(
  s.candidates_created_total,
  COALESCE((SELECT count(*) FROM public.candidates c WHERE c.user_id = s.user_id), 0)
);

CREATE OR REPLACE FUNCTION public.enforce_candidate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used integer;
BEGIN
  SELECT max_candidates, candidates_created_total
    INTO v_limit, v_used
  FROM public.subscriptions
  WHERE user_id = NEW.user_id
  LIMIT 1;

  IF v_limit IS NULL THEN
    v_limit := 3;
  END IF;
  IF v_used IS NULL THEN
    v_used := 0;
  END IF;

  IF v_used >= v_limit THEN
    RAISE EXCEPTION 'candidate_limit_reached: % de % créditos vitalícios usados.', v_used, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lifetime counter: increments on every insert, never decrements on delete.
  UPDATE public.subscriptions
     SET candidates_created_total = COALESCE(candidates_created_total, 0) + 1
   WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_candidate_limit_trigger ON public.candidates;
CREATE TRIGGER enforce_candidate_limit_trigger
BEFORE INSERT ON public.candidates
FOR EACH ROW EXECUTE FUNCTION public.enforce_candidate_limit();
