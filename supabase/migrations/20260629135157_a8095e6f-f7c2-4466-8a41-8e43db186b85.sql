
CREATE OR REPLACE FUNCTION public.enforce_candidate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_count integer;
BEGIN
  SELECT max_candidates INTO v_limit
  FROM public.subscriptions
  WHERE user_id = NEW.user_id
  LIMIT 1;

  IF v_limit IS NULL THEN
    v_limit := 3; -- safe default when no subscription row exists
  END IF;

  SELECT count(*) INTO v_count
  FROM public.candidates
  WHERE user_id = NEW.user_id;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'candidate_limit_reached: % de % candidatos usados no plano atual.', v_count, v_limit
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_candidate_limit_trigger ON public.candidates;
CREATE TRIGGER enforce_candidate_limit_trigger
BEFORE INSERT ON public.candidates
FOR EACH ROW EXECUTE FUNCTION public.enforce_candidate_limit();
