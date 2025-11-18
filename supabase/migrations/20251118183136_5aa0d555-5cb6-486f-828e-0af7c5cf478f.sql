-- Create table for undecided voter analyses
CREATE TABLE public.undecided_analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  
  -- Analysis metrics
  undecided_percentage NUMERIC,
  neutral_profiles_count INTEGER DEFAULT 0,
  total_profiles_analyzed INTEGER DEFAULT 0,
  
  -- AI analysis results (JSON)
  behavioral_patterns JSONB DEFAULT '[]'::jsonb,
  decision_triggers JSONB DEFAULT '[]'::jsonb,
  demographic_profile JSONB DEFAULT '{}'::jsonb,
  key_topics TEXT[] DEFAULT '{}',
  persuasion_strategies JSONB DEFAULT '[]'::jsonb,
  sentiment_fluctuation_score NUMERIC,
  
  -- Metadata
  ai_model_used TEXT,
  confidence_score NUMERIC,
  analysis_period_start TIMESTAMP WITH TIME ZONE,
  analysis_period_end TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  CONSTRAINT undecided_analyses_candidate_id_fkey 
    FOREIGN KEY (candidate_id) 
    REFERENCES public.candidates(id) 
    ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.undecided_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own undecided analyses"
  ON public.undecided_analyses
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own undecided analyses"
  ON public.undecided_analyses
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own undecided analyses"
  ON public.undecided_analyses
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all undecided analyses"
  ON public.undecided_analyses
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for performance
CREATE INDEX idx_undecided_analyses_user_id ON public.undecided_analyses(user_id);
CREATE INDEX idx_undecided_analyses_candidate_id ON public.undecided_analyses(candidate_id);
CREATE INDEX idx_undecided_analyses_created_at ON public.undecided_analyses(created_at DESC);

-- Trigger for updated_at
CREATE TRIGGER update_undecided_analyses_updated_at
  BEFORE UPDATE ON public.undecided_analyses
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();