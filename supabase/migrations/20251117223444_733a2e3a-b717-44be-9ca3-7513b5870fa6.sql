-- Create candidate_rankings table
CREATE TABLE candidate_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  
  -- Calculated Metrics (0-100)
  overall_score NUMERIC(5,2) NOT NULL,
  reach_score NUMERIC(5,2) NOT NULL,
  engagement_score NUMERIC(5,2) NOT NULL,
  positive_perception NUMERIC(5,2) NOT NULL,
  negative_perception NUMERIC(5,2) NOT NULL,
  speech_impact_score NUMERIC(5,2),
  trend_score NUMERIC(5,2) NOT NULL,
  
  -- Ranking Data
  rank_position INTEGER NOT NULL,
  rank_change INTEGER DEFAULT 0,
  
  -- Period Metadata
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Constraint: One ranking per candidate per period
  UNIQUE(candidate_id, period_start, period_end)
);

-- Indexes for Performance
CREATE INDEX idx_rankings_user_period ON candidate_rankings(user_id, period_start, period_end);
CREATE INDEX idx_rankings_score ON candidate_rankings(overall_score DESC);
CREATE INDEX idx_rankings_position ON candidate_rankings(rank_position ASC);

-- Row Level Security
ALTER TABLE candidate_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own rankings"
  ON candidate_rankings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rankings"
  ON candidate_rankings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rankings"
  ON candidate_rankings FOR DELETE
  USING (auth.uid() = user_id);