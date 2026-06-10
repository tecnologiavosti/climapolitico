
ALTER TABLE public.nitter_instances
  ADD COLUMN IF NOT EXISTS success_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS latency_ms_avg INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_collected BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blacklisted_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_nitter_healthy
  ON public.nitter_instances (consecutive_failures, last_checked DESC)
  WHERE is_active = true AND blacklisted_until IS NULL;
