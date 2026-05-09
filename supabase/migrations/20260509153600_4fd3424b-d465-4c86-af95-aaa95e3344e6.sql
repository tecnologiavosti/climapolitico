
-- Usage limits per tier
CREATE TABLE IF NOT EXISTS public.usage_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL,
  event_type text NOT NULL,
  monthly_limit integer NOT NULL,
  hard_block boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tier, event_type)
);
ALTER TABLE public.usage_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage usage_limits" ON public.usage_limits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Authenticated read usage_limits" ON public.usage_limits
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.usage_limits (tier, event_type, monthly_limit, hard_block) VALUES
  ('basic','ai_analysis', 500, true),
  ('basic','export', 20, true),
  ('basic','speech_analysis', 10, true),
  ('basic','collection_run', 100, false),
  ('pro','ai_analysis', 10000, true),
  ('pro','export', 500, true),
  ('pro','speech_analysis', 200, true),
  ('pro','collection_run', 5000, false)
ON CONFLICT DO NOTHING;

-- Check current usage vs limit
CREATE OR REPLACE FUNCTION public.check_usage_limit(_user_id uuid, _event_type text)
RETURNS TABLE(allowed boolean, used bigint, monthly_limit integer, remaining bigint, hard_block boolean, tier text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tier text;
  v_limit integer;
  v_block boolean;
  v_used bigint;
BEGIN
  SELECT s.tier::text INTO v_tier FROM public.subscriptions s WHERE s.user_id = _user_id LIMIT 1;
  IF v_tier IS NULL THEN v_tier := 'basic'; END IF;

  SELECT ul.monthly_limit, ul.hard_block INTO v_limit, v_block
    FROM public.usage_limits ul
    WHERE ul.tier = v_tier AND ul.event_type = _event_type LIMIT 1;

  IF v_limit IS NULL THEN
    RETURN QUERY SELECT true, 0::bigint, NULL::integer, NULL::bigint, false, v_tier;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity),0)::bigint INTO v_used
    FROM public.usage_events
    WHERE user_id = _user_id AND event_type = _event_type
      AND occurred_at > date_trunc('month', now());

  RETURN QUERY SELECT (v_used < v_limit), v_used, v_limit, GREATEST(v_limit - v_used,0)::bigint, v_block, v_tier;
END; $$;

-- Enforce + record
CREATE OR REPLACE FUNCTION public.enforce_usage_limit(
  _user_id uuid, _event_type text, _resource text DEFAULT NULL,
  _quantity integer DEFAULT 1, _cost_units numeric DEFAULT 0, _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_id bigint;
BEGIN
  SELECT * INTO r FROM public.check_usage_limit(_user_id, _event_type);
  IF NOT r.allowed AND r.hard_block THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'limit_exceeded', 'used', r.used, 'limit', r.monthly_limit, 'tier', r.tier);
  END IF;
  v_id := public.record_usage_event(_user_id, _event_type, _resource, _quantity, _cost_units, _metadata);
  RETURN jsonb_build_object('allowed', true, 'event_id', v_id, 'remaining', GREATEST(COALESCE(r.remaining,0) - _quantity, 0), 'tier', r.tier);
END; $$;

-- Webhook endpoints
CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL DEFAULT ARRAY[]::text[],
  secret text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_user ON public.webhook_endpoints(user_id);
ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own webhooks" ON public.webhook_endpoints
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all webhooks" ON public.webhook_endpoints
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id bigserial PRIMARY KEY,
  endpoint_id uuid NOT NULL REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  status_code integer,
  response_body text,
  attempts integer NOT NULL DEFAULT 0,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON public.webhook_deliveries(endpoint_id, created_at DESC);
ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING (endpoint_id IN (SELECT id FROM public.webhook_endpoints WHERE user_id = auth.uid()));
CREATE POLICY "Admins view all deliveries" ON public.webhook_deliveries
  FOR SELECT TO authenticated USING (has_role(auth.uid(),'admin'::app_role));
