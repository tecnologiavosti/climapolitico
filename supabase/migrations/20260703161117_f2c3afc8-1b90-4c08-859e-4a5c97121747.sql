ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_first_login boolean NOT NULL DEFAULT true;
-- Backfill: existing users are NOT considered first-login (don't disturb them)
UPDATE public.profiles SET is_first_login = false WHERE is_first_login IS DISTINCT FROM false AND created_at < now() - interval '1 minute';