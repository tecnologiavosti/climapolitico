
-- =========================================================================
-- 1) DLQ: failed_analyses
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.failed_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid,
  candidate_id uuid,
  user_id uuid,
  comment_text text,
  attempts integer NOT NULL DEFAULT 1,
  last_error text,
  provider_used text,
  first_failed_at timestamptz NOT NULL DEFAULT now(),
  last_failed_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_failed_analyses_unresolved
  ON public.failed_analyses (last_failed_at DESC)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_failed_analyses_interaction
  ON public.failed_analyses (interaction_id);

ALTER TABLE public.failed_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage failed analyses"
  ON public.failed_analyses
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- =========================================================================
-- 2) social_interactions: analysis_attempts + sentiment_confidence
-- =========================================================================
ALTER TABLE public.social_interactions
  ADD COLUMN IF NOT EXISTS analysis_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sentiment_confidence numeric;

CREATE INDEX IF NOT EXISTS idx_social_interactions_pending_analysis
  ON public.social_interactions (created_at DESC)
  WHERE sentiment_label IS NULL AND analysis_attempts < 5;

CREATE INDEX IF NOT EXISTS idx_social_interactions_low_confidence
  ON public.social_interactions (created_at DESC)
  WHERE sentiment_label = 'Neutro' AND (sentiment_confidence IS NULL OR sentiment_confidence < 0.6);

-- Permitir UPDATE pelo dono (necessário p/ reanálise + refine)
DROP POLICY IF EXISTS "Users can update their own interactions" ON public.social_interactions;
CREATE POLICY "Users can update their own interactions"
  ON public.social_interactions
  FOR UPDATE
  TO public
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 3) profiles: onboarding persistido em DB
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

-- =========================================================================
-- 4) View pipeline_health (admins)
-- =========================================================================
CREATE OR REPLACE VIEW public.pipeline_health
WITH (security_invoker = true)
AS
SELECT
  candidate_id,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE sentiment_label IS NULL) AS unlabeled,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sentiment_label IS NULL) / NULLIF(COUNT(*),0), 2) AS pct_unlabeled,
  COUNT(*) FILTER (WHERE sentiment_label = 'Neutro' AND COALESCE(sentiment_confidence,0) < 0.6) AS low_conf_neutrals,
  COUNT(*) FILTER (WHERE analysis_attempts >= 5 AND sentiment_label IS NULL) AS dead_letter
FROM public.social_interactions
GROUP BY candidate_id;

-- =========================================================================
-- 5) Limpeza automática de notificações
-- =========================================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_notifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH d AS (
    DELETE FROM public.notifications
    WHERE (is_read = true AND created_at < now() - interval '30 days')
       OR (is_read = false AND created_at < now() - interval '90 days')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM d;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_notifications() FROM PUBLIC, anon, authenticated;

-- pg_cron: 03:00 UTC diário
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('cleanup-old-notifications');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'cleanup-old-notifications',
  '0 3 * * *',
  $$ SELECT public.cleanup_old_notifications(); $$
);

-- =========================================================================
-- 6) Hardening: revogar EXECUTE de SECURITY DEFINER de funções DB-only
-- =========================================================================
REVOKE EXECUTE ON FUNCTION public.refresh_network_profiles_deduplicated() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.skip_duplicate_social_interaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_candidate_after_analysis() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.should_skip_collector(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_collector_call(text, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalize_social_network() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_edge_function_logs() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_candidate_change_notification() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reactivate_youtube_keys() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_social_interaction_region() FROM PUBLIC, anon, authenticated;

-- has_role precisa ficar acessível para authenticated (RLS depende dele); só revogamos de anon.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;

-- get_network_profiles_stats já checa has_role internamente — mantém p/ authenticated.
