
-- 1) Snapshot do estado dos coletores
CREATE TABLE IF NOT EXISTS public.collector_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_label text NOT NULL,
  collector_name text NOT NULL,
  daily_calls integer NOT NULL DEFAULT 0,
  daily_errors integer NOT NULL DEFAULT 0,
  daily_items_collected integer NOT NULL DEFAULT 0,
  max_daily_calls integer NOT NULL DEFAULT 0,
  paused_until timestamptz,
  last_call_at timestamptz,
  notes text,
  taken_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.collector_snapshots TO authenticated;
GRANT ALL ON public.collector_snapshots TO service_role;
ALTER TABLE public.collector_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read collector snapshots"
  ON public.collector_snapshots FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 2) Snapshot do volume por rede social
CREATE TABLE IF NOT EXISTS public.collector_volume_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_label text NOT NULL,
  social_network text NOT NULL,
  volume_24h bigint NOT NULL DEFAULT 0,
  volume_7d bigint NOT NULL DEFAULT 0,
  volume_30d bigint NOT NULL DEFAULT 0,
  volume_30d_previous bigint NOT NULL DEFAULT 0,
  taken_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.collector_volume_snapshots TO authenticated;
GRANT ALL ON public.collector_volume_snapshots TO service_role;
ALTER TABLE public.collector_volume_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read volume snapshots"
  ON public.collector_volume_snapshots FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 3) Popular o snapshot inicial "pre-fix-2026-06-10"
INSERT INTO public.collector_snapshots
  (snapshot_label, collector_name, daily_calls, daily_errors, daily_items_collected,
   max_daily_calls, paused_until, last_call_at, notes)
SELECT 'pre-fix-2026-06-10', collector_name, daily_calls, daily_errors, daily_items_collected,
       max_daily_calls, paused_until, last_call_at, notes
FROM public.collector_quota_state;

INSERT INTO public.collector_volume_snapshots
  (snapshot_label, social_network, volume_24h, volume_7d, volume_30d, volume_30d_previous)
SELECT 'pre-fix-2026-06-10',
       lower(social_network),
       COUNT(*) FILTER (WHERE collected_at >= now() - interval '24 hours'),
       COUNT(*) FILTER (WHERE collected_at >= now() - interval '7 days'),
       COUNT(*) FILTER (WHERE collected_at >= now() - interval '30 days'),
       COUNT(*) FILTER (WHERE collected_at >= now() - interval '60 days'
                          AND collected_at <  now() - interval '30 days')
FROM public.social_interactions
GROUP BY lower(social_network);
