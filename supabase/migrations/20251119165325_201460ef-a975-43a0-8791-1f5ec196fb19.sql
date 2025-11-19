-- Add temporal analysis columns to speech_analyses table
ALTER TABLE speech_analyses
ADD COLUMN analysis_period_start TIMESTAMP WITH TIME ZONE,
ADD COLUMN analysis_period_end TIMESTAMP WITH TIME ZONE,
ADD COLUMN individual_speeches JSONB DEFAULT '[]'::jsonb,
ADD COLUMN period_summary JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN speech_analyses.analysis_period_start IS 'Start date for temporal analysis period';
COMMENT ON COLUMN speech_analyses.analysis_period_end IS 'End date for temporal analysis period';
COMMENT ON COLUMN speech_analyses.individual_speeches IS 'Array of individual speeches detected: [{speech_text, post_date, reactions_count, sentiment, trigger_words, risk_level, psychological_impact, affected_profiles}]';
COMMENT ON COLUMN speech_analyses.period_summary IS 'Aggregated summary for the period: {total_speeches, avg_risk_level, most_problematic_words, overall_sentiment, sentiment_distribution, recommendations}';

CREATE INDEX idx_speech_analyses_period ON speech_analyses(analysis_period_start, analysis_period_end);