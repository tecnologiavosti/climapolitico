CREATE OR REPLACE FUNCTION public.enforce_candidate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_used integer;
  v_tier text;
BEGIN
  SELECT lower(coalesce(tier::text, '')), max_candidates, candidates_created_total
    INTO v_tier, v_limit, v_used
  FROM public.subscriptions
  WHERE user_id = NEW.user_id
  LIMIT 1;

  -- VIP/Vitalício nunca bloqueia e não consome créditos de candidato.
  IF v_tier IN ('vip', 'lifetime', 'vitalicio', 'vitalício') THEN
    RETURN NEW;
  END IF;

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

  UPDATE public.subscriptions
     SET candidates_created_total = COALESCE(candidates_created_total, 0) + 1
   WHERE user_id = NEW.user_id;

  RETURN NEW;
END;
$$;

UPDATE public.subscriptions
   SET max_candidates = GREATEST(max_candidates, 999999),
       max_updates_per_month = GREATEST(max_updates_per_month, 999999)
 WHERE lower(tier::text) IN ('vip', 'lifetime', 'vitalicio', 'vitalício');

UPDATE public.subscription_plans
   SET max_candidates = GREATEST(max_candidates, 999999),
       max_updates_per_month = GREATEST(max_updates_per_month, 999999)
 WHERE lower(tier::text) IN ('vip', 'lifetime', 'vitalicio', 'vitalício');