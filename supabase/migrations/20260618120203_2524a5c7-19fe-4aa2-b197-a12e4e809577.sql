
-- 1. Expand subscription_tier enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='free' AND enumtypid='public.subscription_tier'::regtype) THEN
    ALTER TYPE public.subscription_tier ADD VALUE 'free';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='starter' AND enumtypid='public.subscription_tier'::regtype) THEN
    ALTER TYPE public.subscription_tier ADD VALUE 'starter';
  END IF;
END $$;

-- 2. Profile admin-only fields
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS suspended_until timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_reason text;

-- 3. Subscription expiration override already exists as current_period_end. Add custom flag.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS notes text;

-- 4. Billing history
CREATE TABLE IF NOT EXISTS public.billing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  tier text,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending','failed','refunded','cancelled')),
  method text,
  description text,
  external_reference text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_history TO authenticated;
GRANT ALL ON public.billing_history TO service_role;

ALTER TABLE public.billing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own billing" ON public.billing_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.has_admin_access(auth.uid()));
CREATE POLICY "Admins manage billing" ON public.billing_history
  FOR ALL TO authenticated USING (public.has_admin_access(auth.uid())) WITH CHECK (public.has_admin_access(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_billing_history_user ON public.billing_history(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_history_status ON public.billing_history(status);

CREATE TRIGGER trg_billing_history_updated
  BEFORE UPDATE ON public.billing_history
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
