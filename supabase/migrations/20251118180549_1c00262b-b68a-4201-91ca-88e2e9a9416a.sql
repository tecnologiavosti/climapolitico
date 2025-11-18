-- Create analysis_sources table for detailed source tracking
CREATE TABLE IF NOT EXISTS analysis_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id UUID NOT NULL REFERENCES candidate_analyses(id) ON DELETE CASCADE,
  
  -- Source identification
  source_type TEXT NOT NULL,
  social_network TEXT NOT NULL,
  profile_username TEXT,
  profile_url TEXT,
  profile_unique_id TEXT NOT NULL,
  
  -- Quantitative data
  posts_collected INTEGER DEFAULT 0,
  comments_collected INTEGER DEFAULT 0,
  interactions_count INTEGER DEFAULT 0,
  followers_at_collection INTEGER,
  
  -- Geographic data
  profile_location_state TEXT,
  profile_location_city TEXT,
  inferred_region TEXT,
  
  -- Metadata
  collection_method TEXT,
  collection_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  data_quality_score NUMERIC(3,2),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_analysis_sources_analysis_id ON analysis_sources(analysis_id);
CREATE INDEX IF NOT EXISTS idx_analysis_sources_social_network ON analysis_sources(social_network);
CREATE INDEX IF NOT EXISTS idx_analysis_sources_state ON analysis_sources(profile_location_state);

-- Enable RLS
ALTER TABLE analysis_sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own analysis sources"
  ON analysis_sources FOR SELECT
  USING (
    analysis_id IN (
      SELECT id FROM candidate_analyses WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "System can insert analysis sources"
  ON analysis_sources FOR INSERT
  WITH CHECK (
    analysis_id IN (
      SELECT id FROM candidate_analyses WHERE user_id = auth.uid()
    )
  );

-- Add summary fields to candidate_analyses
ALTER TABLE candidate_analyses
  ADD COLUMN IF NOT EXISTS total_profiles_analyzed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unique_profiles_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS primary_data_source TEXT,
  ADD COLUMN IF NOT EXISTS geographic_scope TEXT,
  ADD COLUMN IF NOT EXISTS data_quality_score NUMERIC(3,2) DEFAULT 0.8;