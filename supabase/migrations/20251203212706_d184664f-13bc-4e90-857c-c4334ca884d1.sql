-- Criar tabela social_interactions para monitoramento em tempo real
CREATE TABLE public.social_interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  analysis_id UUID REFERENCES public.candidate_analyses(id) ON DELETE SET NULL,
  
  -- Dados do comentário/interação
  comment_text TEXT,
  comment_author TEXT,
  author_profile_url TEXT,
  social_network TEXT NOT NULL,
  interaction_type TEXT NOT NULL DEFAULT 'comment',
  
  -- Análise de sentimento
  sentiment_label TEXT,
  sentiment_score NUMERIC,
  
  -- Métricas
  likes_count INTEGER DEFAULT 0,
  replies_count INTEGER DEFAULT 0,
  shares_count INTEGER DEFAULT 0,
  
  -- Timestamps
  original_posted_at TIMESTAMP WITH TIME ZONE,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índices para performance
CREATE INDEX idx_social_interactions_candidate_id ON public.social_interactions(candidate_id);
CREATE INDEX idx_social_interactions_user_id ON public.social_interactions(user_id);
CREATE INDEX idx_social_interactions_created_at ON public.social_interactions(created_at DESC);
CREATE INDEX idx_social_interactions_sentiment ON public.social_interactions(sentiment_label);

-- Habilitar RLS
ALTER TABLE public.social_interactions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
CREATE POLICY "Users can view their own interactions"
ON public.social_interactions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own interactions"
ON public.social_interactions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own interactions"
ON public.social_interactions
FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all interactions"
ON public.social_interactions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.social_interactions;