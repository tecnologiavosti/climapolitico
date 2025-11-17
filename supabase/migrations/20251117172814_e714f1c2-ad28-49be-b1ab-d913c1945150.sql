-- Create speech_analyses table for intelligent speech analysis
CREATE TABLE speech_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID REFERENCES candidates(id),
  
  -- Speech data
  speech_title TEXT NOT NULL,
  speech_text TEXT NOT NULL,
  speech_date TIMESTAMPTZ,
  speech_type TEXT, -- 'entrevista', 'discurso', 'debate', 'video'
  speech_duration INTEGER, -- in seconds
  
  -- Audio/Video
  media_url TEXT,
  media_type TEXT, -- 'audio', 'video', 'text'
  transcription_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  
  -- Trigger analysis
  trigger_words JSONB DEFAULT '[]'::jsonb, -- [{word, position, severity, reason}]
  problematic_segments JSONB DEFAULT '[]'::jsonb, -- [{text, issue, emotion}]
  
  -- Impact analysis
  negative_perception_score NUMERIC(3,2), -- 0-10
  risk_level INTEGER, -- 1-10
  affected_voter_profiles JSONB, -- ['jovens', 'classe-media', etc]
  
  -- Psychological analysis (from AI)
  psychological_impact TEXT,
  emotional_analysis JSONB, -- {anger: 30, fear: 20, joy: 10, ...}
  
  -- Recommendations
  recommended_actions JSONB DEFAULT '[]'::jsonb, -- array of actions
  communication_suggestions JSONB DEFAULT '[]'::jsonb,
  
  -- Metadata
  ai_model_used TEXT,
  analysis_confidence NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE speech_analyses ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own speech analyses"
  ON speech_analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own speech analyses"
  ON speech_analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own speech analyses"
  ON speech_analyses FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_speech_analyses_updated_at
  BEFORE UPDATE ON speech_analyses
  FOR EACH ROW
  EXECUTE FUNCTION handle_updated_at();