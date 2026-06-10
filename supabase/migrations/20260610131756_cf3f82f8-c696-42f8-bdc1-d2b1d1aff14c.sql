
-- F1: Telemetria do pipeline de coleta
CREATE TABLE IF NOT EXISTS public.collector_pipeline_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collector_name text NOT NULL,
  candidate_id uuid,
  collected_count integer NOT NULL DEFAULT 0,
  parsed_count integer NOT NULL DEFAULT 0,
  filtered_count integer NOT NULL DEFAULT 0,
  deduped_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  execution_time_ms integer,
  discard_reasons jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  had_error boolean NOT NULL DEFAULT false,
  error_message text,
  executed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.collector_pipeline_metrics TO authenticated;
GRANT ALL ON public.collector_pipeline_metrics TO service_role;

ALTER TABLE public.collector_pipeline_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read pipeline metrics"
  ON public.collector_pipeline_metrics
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Service role writes pipeline metrics"
  ON public.collector_pipeline_metrics
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_collector_time
  ON public.collector_pipeline_metrics (collector_name, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_metrics_recent
  ON public.collector_pipeline_metrics (executed_at DESC);

-- Helper RPC: edge functions chamam isso em vez de INSERT direto
CREATE OR REPLACE FUNCTION public.record_pipeline_stage(
  _collector text,
  _candidate_id uuid,
  _collected integer,
  _parsed integer,
  _filtered integer,
  _deduped integer,
  _inserted integer,
  _execution_ms integer,
  _discard_reasons jsonb DEFAULT '{}'::jsonb,
  _source_breakdown jsonb DEFAULT '{}'::jsonb,
  _had_error boolean DEFAULT false,
  _error_message text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
BEGIN
  INSERT INTO public.collector_pipeline_metrics (
    collector_name, candidate_id, collected_count, parsed_count,
    filtered_count, deduped_count, inserted_count, execution_time_ms,
    discard_reasons, source_breakdown, had_error, error_message
  ) VALUES (
    _collector, _candidate_id, COALESCE(_collected, 0), COALESCE(_parsed, 0),
    COALESCE(_filtered, 0), COALESCE(_deduped, 0), COALESCE(_inserted, 0), _execution_ms,
    COALESCE(_discard_reasons, '{}'::jsonb), COALESCE(_source_breakdown, '{}'::jsonb),
    COALESCE(_had_error, false), _error_message
  ) RETURNING id INTO _id;
  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_pipeline_stage(text,uuid,integer,integer,integer,integer,integer,integer,jsonb,jsonb,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_pipeline_stage(text,uuid,integer,integer,integer,integer,integer,integer,jsonb,jsonb,boolean,text) TO service_role;

-- F6: pausar Brand24 por 30 dias (mesma migração para garantir atomicidade)
INSERT INTO public.collector_quota_state (collector_name, paused_until, notes)
VALUES ('brand24', now() + interval '30 days', 'F6: pausa automática — 22/22 falhas em 24h, token inválido')
ON CONFLICT (collector_name)
DO UPDATE SET
  paused_until = now() + interval '30 days',
  notes = 'F6: pausa automática — 22/22 falhas em 24h, token inválido',
  updated_at = now();
