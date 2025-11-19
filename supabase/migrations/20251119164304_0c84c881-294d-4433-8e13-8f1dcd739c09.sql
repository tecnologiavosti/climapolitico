-- Add source tracking columns to speech_analyses table
ALTER TABLE speech_analyses 
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual' CHECK (source_type IN ('manual', 'social_media')),
ADD COLUMN IF NOT EXISTS source_analysis_id UUID REFERENCES candidate_analyses(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_speech_analyses_source ON speech_analyses(source_type, source_analysis_id);

-- Add comment for documentation
COMMENT ON COLUMN speech_analyses.source_type IS 'Indicates whether analysis was done on manual text or social media data';
COMMENT ON COLUMN speech_analyses.source_analysis_id IS 'Links to the candidate_analyses that provided the social media data';