CREATE OR REPLACE FUNCTION public.create_candidate_change_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate_name TEXT;
  v_old_sent NUMERIC;
  v_new_sent NUMERIC;
  v_sent_delta NUMERIC;
  v_old_men NUMERIC;
  v_new_men NUMERIC;
  v_men_pct NUMERIC;
BEGIN
  SELECT full_name INTO v_candidate_name
  FROM public.candidates
  WHERE id = NEW.candidate_id;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.notifications (user_id, candidate_id, title, message, type, severity, metadata)
    VALUES (NEW.user_id, NEW.candidate_id, 'Monitoramento iniciado',
      format('Os primeiros indicadores de %s já estão disponíveis na plataforma.', COALESCE(v_candidate_name, 'seu candidato')),
      'candidate_update', 'info',
      jsonb_build_object('average_sentiment', NEW.average_sentiment, 'total_mentions', NEW.total_mentions));
    RETURN NEW;
  END IF;

  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Sentiment alert: delta in points >= 5
  v_old_sent := COALESCE(OLD.average_sentiment, 0);
  v_new_sent := COALESCE(NEW.average_sentiment, 0);
  v_sent_delta := v_new_sent - v_old_sent;

  IF ABS(v_sent_delta) >= 5 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = NEW.user_id
        AND candidate_id = NEW.candidate_id
        AND type = 'sentiment'
        AND created_at > now() - interval '2 hours'
    ) THEN
      INSERT INTO public.notifications (user_id, candidate_id, title, message, type, severity, metadata)
      VALUES (NEW.user_id, NEW.candidate_id,
        'Sentimento atualizado',
        format('%s %s de %s para %s pontos de sentimento.',
          COALESCE(v_candidate_name, 'Seu candidato'),
          CASE WHEN v_sent_delta > 0 THEN 'subiu' ELSE 'caiu' END,
          ROUND(v_old_sent)::TEXT, ROUND(v_new_sent)::TEXT),
        'sentiment',
        CASE WHEN v_sent_delta < 0 THEN 'warning' ELSE 'success' END,
        jsonb_build_object('old', v_old_sent, 'new', v_new_sent, 'delta', v_sent_delta));
    END IF;
  END IF;

  -- Volume alert: pct change >= 20%
  v_old_men := COALESCE(OLD.total_mentions, 0);
  v_new_men := COALESCE(NEW.total_mentions, 0);
  IF v_old_men > 0 THEN
    v_men_pct := (v_new_men - v_old_men) / v_old_men * 100;
  ELSIF v_new_men > 0 THEN
    v_men_pct := 100;
  ELSE
    v_men_pct := 0;
  END IF;

  IF ABS(v_men_pct) >= 20 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = NEW.user_id
        AND candidate_id = NEW.candidate_id
        AND type = 'volume'
        AND created_at > now() - interval '2 hours'
    ) THEN
      INSERT INTO public.notifications (user_id, candidate_id, title, message, type, severity, metadata)
      VALUES (NEW.user_id, NEW.candidate_id,
        CASE WHEN ABS(v_men_pct) >= 100 THEN 'Alta repercussão detectada' ELSE 'Volume de menções atualizado' END,
        format('%s teve %s de %s%% no volume de menções (%s → %s).',
          COALESCE(v_candidate_name, 'Seu candidato'),
          CASE WHEN v_men_pct > 0 THEN 'aumento' ELSE 'queda' END,
          ROUND(ABS(v_men_pct))::TEXT,
          v_old_men::TEXT, v_new_men::TEXT),
        'volume',
        CASE WHEN ABS(v_men_pct) >= 100 THEN 'error'
             WHEN v_men_pct < 0 THEN 'warning'
             ELSE 'info' END,
        jsonb_build_object('old', v_old_men, 'new', v_new_men, 'pct', v_men_pct));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;