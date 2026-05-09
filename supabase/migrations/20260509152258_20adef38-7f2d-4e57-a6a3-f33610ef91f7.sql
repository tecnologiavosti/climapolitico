
CREATE TABLE IF NOT EXISTS public.usage_events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  event_type text NOT NULL, -- 'ai_analysis' | 'export' | 'api_request' | 'collection_run' | 'speech_analysis'
  resource text,
  quantity integer NOT NULL DEFAULT 1,
  cost_units numeric NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_time
  ON public.usage_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_time
  ON public.usage_events (event_type, occurred_at DESC);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own usage" ON public.usage_events;
CREATE POLICY "Users view own usage" ON public.usage_events
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR has_role(auth.uid(),'admin'::app_role));

-- Record usage (called via service role from edge functions)
CREATE OR REPLACE FUNCTION public.record_usage_event(
  _user_id uuid,
  _event_type text,
  _resource text DEFAULT NULL,
  _quantity integer DEFAULT 1,
  _cost_units numeric DEFAULT 0,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.usage_events (user_id, event_type, resource, quantity, cost_units, metadata)
  VALUES (_user_id, _event_type, _resource, GREATEST(_quantity,0), GREATEST(_cost_units,0), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE EXECUTE ON FUNCTION public.record_usage_event(uuid,text,text,integer,numeric,jsonb) FROM anon, authenticated;

-- Per-user usage summary
CREATE OR REPLACE FUNCTION public.get_user_usage_summary(_days integer DEFAULT 30)
RETURNS TABLE(event_type text, total_quantity bigint, total_cost numeric, last_event timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  RETURN QUERY
  SELECT u.event_type,
         COALESCE(SUM(u.quantity),0)::bigint,
         COALESCE(SUM(u.cost_units),0)::numeric,
         MAX(u.occurred_at)
  FROM public.usage_events u
  WHERE u.user_id = auth.uid()
    AND u.occurred_at > now() - make_interval(days => GREATEST(_days,1))
  GROUP BY u.event_type
  ORDER BY total_quantity DESC;
END; $$;

-- Tenant analytics (admin only)
CREATE OR REPLACE FUNCTION public.get_tenant_analytics(_days integer DEFAULT 30, _limit integer DEFAULT 50)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  tier text,
  total_events bigint,
  total_cost numeric,
  ai_analyses bigint,
  exports bigint,
  last_active timestamptz
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
  SELECT u.user_id,
         p.full_name,
         s.tier::text,
         COUNT(*)::bigint AS total_events,
         COALESCE(SUM(u.cost_units),0)::numeric AS total_cost,
         COUNT(*) FILTER (WHERE u.event_type = 'ai_analysis')::bigint AS ai_analyses,
         COUNT(*) FILTER (WHERE u.event_type = 'export')::bigint AS exports,
         MAX(u.occurred_at) AS last_active
  FROM public.usage_events u
  LEFT JOIN public.profiles p ON p.id = u.user_id
  LEFT JOIN public.subscriptions s ON s.user_id = u.user_id
  WHERE u.occurred_at > now() - make_interval(days => GREATEST(_days,1))
  GROUP BY u.user_id, p.full_name, s.tier
  ORDER BY total_cost DESC, total_events DESC
  LIMIT GREATEST(_limit,1);
END; $$;
