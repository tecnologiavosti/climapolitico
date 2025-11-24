-- Criar tabela principal de insights gerados por IA
CREATE TABLE public.ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('crisis', 'opportunity', 'trend', 'recommendation')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommended_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  supporting_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  dismissed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Criar índices para performance
CREATE INDEX idx_ai_insights_user_id ON public.ai_insights(user_id);
CREATE INDEX idx_ai_insights_candidate_id ON public.ai_insights(candidate_id);
CREATE INDEX idx_ai_insights_type ON public.ai_insights(insight_type);
CREATE INDEX idx_ai_insights_priority ON public.ai_insights(priority);
CREATE INDEX idx_ai_insights_active ON public.ai_insights(is_active) WHERE is_active = true;
CREATE INDEX idx_ai_insights_created_at ON public.ai_insights(created_at DESC);

-- Habilitar RLS
ALTER TABLE public.ai_insights ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver apenas seus próprios insights
CREATE POLICY "Users can view own insights"
  ON public.ai_insights FOR SELECT
  USING (auth.uid() = user_id);

-- Usuários podem criar insights (via edge function)
CREATE POLICY "Users can create own insights"
  ON public.ai_insights FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Usuários podem atualizar seus insights (marcar como lido, descartar)
CREATE POLICY "Users can update own insights"
  ON public.ai_insights FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Usuários podem deletar seus próprios insights
CREATE POLICY "Users can delete own insights"
  ON public.ai_insights FOR DELETE
  USING (auth.uid() = user_id);

-- Admins têm acesso total
CREATE POLICY "Admins can view all insights"
  ON public.ai_insights FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage all insights"
  ON public.ai_insights FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger para updated_at
CREATE TRIGGER update_ai_insights_updated_at
  BEFORE UPDATE ON public.ai_insights
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();