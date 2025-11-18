-- Adicionar role admin ao usuário empresaswgm@gmail.com (idempotente)
INSERT INTO public.user_roles (user_id, role)
VALUES ('d640ee43-472a-43cf-8ffa-4b1fdab57d28', 'admin')
ON CONFLICT DO NOTHING;

-- Criar políticas RLS para admin em todas as tabelas
-- (usa DROP POLICY IF EXISTS para garantir idempotência)

-- Subscriptions
DROP POLICY IF EXISTS "Admins can view all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins can view all subscriptions"
  ON public.subscriptions FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update all subscriptions" ON public.subscriptions;
CREATE POLICY "Admins can update all subscriptions"
  ON public.subscriptions FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Candidates
DROP POLICY IF EXISTS "Admins can view all candidates" ON public.candidates;
CREATE POLICY "Admins can view all candidates"
  ON public.candidates FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Candidate Analyses
DROP POLICY IF EXISTS "Admins can view all analyses" ON public.candidate_analyses;
CREATE POLICY "Admins can view all analyses"
  ON public.candidate_analyses FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Candidate Rankings
DROP POLICY IF EXISTS "Admins can view all rankings" ON public.candidate_rankings;
CREATE POLICY "Admins can view all rankings"
  ON public.candidate_rankings FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Speech Analyses
DROP POLICY IF EXISTS "Admins can view all speech analyses" ON public.speech_analyses;
CREATE POLICY "Admins can view all speech analyses"
  ON public.speech_analyses FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

-- Analysis Sources
DROP POLICY IF EXISTS "Admins can view all analysis sources" ON public.analysis_sources;
CREATE POLICY "Admins can view all analysis sources"
  ON public.analysis_sources FOR SELECT
  USING (has_role(auth.uid(), 'admin'));