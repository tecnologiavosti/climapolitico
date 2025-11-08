-- Create candidate_analyses table
CREATE TABLE public.candidate_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  
  -- Dados coletados
  mentions_count integer DEFAULT 0,
  followers_count text,
  posts_analyzed integer DEFAULT 0,
  
  -- Análise Multi-IA
  ai_models_used text[] DEFAULT '{}',
  
  -- Resultados agregados
  sentiment_score numeric,
  sentiment_label text,
  sentiment_confidence numeric,
  
  ideology_label text,
  ideology_confidence numeric,
  
  trend text,
  
  -- Resultados por IA (JSON)
  gemini_flash_result jsonb,
  gemini_pro_result jsonb,
  gpt5_mini_result jsonb,
  
  -- Keywords e insights
  keywords text[],
  topics text[],
  
  -- Metadados
  analysis_status text DEFAULT 'pending',
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_candidate_analyses_candidate_id ON public.candidate_analyses(candidate_id);
CREATE INDEX idx_candidate_analyses_user_id ON public.candidate_analyses(user_id);
CREATE INDEX idx_candidate_analyses_created_at ON public.candidate_analyses(created_at DESC);

-- Enable RLS
ALTER TABLE public.candidate_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own candidate analyses"
  ON public.candidate_analyses FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can insert analyses"
  ON public.candidate_analyses FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own analyses"
  ON public.candidate_analyses FOR DELETE
  USING (user_id = auth.uid());

-- Update candidates table with analysis tracking
ALTER TABLE public.candidates
ADD COLUMN last_analysis_at timestamptz,
ADD COLUMN analysis_count integer DEFAULT 0;

-- Create trigger to update candidates after analysis
CREATE OR REPLACE FUNCTION public.update_candidate_after_analysis()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.candidates
  SET 
    last_analysis_at = NEW.created_at,
    analysis_count = analysis_count + 1,
    sentiment = NEW.sentiment_score,
    trend = NEW.trend,
    mentions = NEW.mentions_count
  WHERE id = NEW.candidate_id;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_candidate_after_analysis
  AFTER INSERT ON public.candidate_analyses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_candidate_after_analysis();