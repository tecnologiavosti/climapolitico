
-- =========================================================
-- 1) Notification throttle + dedup
-- =========================================================
CREATE OR REPLACE FUNCTION public.create_candidate_change_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_candidate_name TEXT;
  v_title TEXT;
  v_message TEXT;
  v_type TEXT := 'candidate_update';
  v_severity TEXT := 'info';
  v_should_notify BOOLEAN := false;
  v_old_val NUMERIC;
  v_new_val NUMERIC;
  v_pct NUMERIC;
BEGIN
  SELECT full_name INTO v_candidate_name
  FROM public.candidates
  WHERE id = NEW.candidate_id;

  IF TG_OP = 'INSERT' THEN
    v_title := 'Monitoramento iniciado';
    v_message := format('Os primeiros indicadores de %s já estão disponíveis na plataforma.', COALESCE(v_candidate_name, 'seu candidato'));
    v_should_notify := true;

  ELSIF TG_OP = 'UPDATE' THEN
    -- sentiment changed > 5%?
    IF COALESCE(OLD.average_sentiment, 0) IS DISTINCT FROM COALESCE(NEW.average_sentiment, 0) THEN
      v_old_val := COALESCE(OLD.average_sentiment, 0);
      v_new_val := COALESCE(NEW.average_sentiment, 0);
      v_pct := CASE WHEN v_old_val > 0 THEN ABS(v_new_val - v_old_val) / v_old_val * 100 ELSE 100 END;
      IF v_pct >= 5 THEN
        v_title := 'Sentimento atualizado';
        v_message := format('%s teve mudança no sentimento médio: %s%% → %s%%.',
          COALESCE(v_candidate_name, 'Seu candidato'),
          ROUND(v_old_val)::TEXT, ROUND(v_new_val)::TEXT);
        v_severity := CASE WHEN v_new_val < v_old_val THEN 'warning' ELSE 'success' END;
        v_should_notify := true;
      END IF;
    -- mentions changed > 5%?
    ELSIF COALESCE(OLD.total_mentions, 0) IS DISTINCT FROM COALESCE(NEW.total_mentions, 0) THEN
      v_old_val := COALESCE(OLD.total_mentions, 0);
      v_new_val := COALESCE(NEW.total_mentions, 0);
      v_pct := CASE WHEN v_old_val > 0 THEN ABS(v_new_val - v_old_val) / v_old_val * 100 ELSE 100 END;
      IF v_pct >= 5 THEN
        v_title := 'Volume de menções atualizado';
        v_message := format('%s agora possui %s menções monitoradas.', COALESCE(v_candidate_name, 'Seu candidato'), v_new_val::TEXT);
        v_should_notify := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_should_notify THEN
    RETURN NEW;
  END IF;

  -- Dedup: skip if same type unread notification exists for this candidate in last hour
  IF EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = NEW.user_id
      AND candidate_id = NEW.candidate_id
      AND title = v_title
      AND is_read = false
      AND created_at > now() - interval '1 hour'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, candidate_id, title, message, type, severity, metadata)
  VALUES (NEW.user_id, NEW.candidate_id, v_title, v_message, v_type, v_severity,
    jsonb_build_object('average_sentiment', NEW.average_sentiment, 'total_mentions', NEW.total_mentions, 'last_calculated_at', NEW.last_calculated_at));

  RETURN NEW;
END;
$function$;

-- =========================================================
-- 2) Edge function logs table (for observability)
-- =========================================================
CREATE TABLE IF NOT EXISTS public.edge_function_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('success','error','partial')),
  error_message text,
  duration_ms integer,
  metadata jsonb DEFAULT '{}'::jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edge_function_logs_recent
  ON public.edge_function_logs (function_name, executed_at DESC);

ALTER TABLE public.edge_function_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view edge function logs" ON public.edge_function_logs;
CREATE POLICY "Admins view edge function logs"
  ON public.edge_function_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Auto-prune logs older than 30 days
CREATE OR REPLACE FUNCTION public.prune_edge_function_logs()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.edge_function_logs WHERE executed_at < now() - interval '30 days';
$$;
