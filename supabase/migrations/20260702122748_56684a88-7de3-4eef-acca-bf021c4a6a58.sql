
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'vip';
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS visible_in_homepage BOOLEAN NOT NULL DEFAULT true;
INSERT INTO public.subscription_plans (tier, display_name, price_monthly, price_yearly, max_candidates, max_updates_per_month, features, is_active, sort_order, visible_in_homepage)
SELECT 'vip', 'VIP', 499, 4990, 9999, 9999, '["Candidatos ilimitados","IA ilimitada","Relatórios ilimitados","Prioridade máxima","Todos os módulos liberados"]'::jsonb, true, 99, false
WHERE NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE tier = 'vip');
