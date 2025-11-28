-- Add three new JSONB columns to store individual AI model results
ALTER TABLE candidate_analyses
ADD COLUMN IF NOT EXISTS gemini_3_pro_result JSONB,
ADD COLUMN IF NOT EXISTS gpt_5_result JSONB,
ADD COLUMN IF NOT EXISTS gpt_5_nano_result JSONB;

-- Add comment to document the new columns
COMMENT ON COLUMN candidate_analyses.gemini_3_pro_result IS 'Individual result from Google Gemini 3 Pro Preview model (sentiment, ideology, sentimentScore, keywords)';
COMMENT ON COLUMN candidate_analyses.gpt_5_result IS 'Individual result from OpenAI GPT-5 model (sentiment, ideology, sentimentScore, keywords)';
COMMENT ON COLUMN candidate_analyses.gpt_5_nano_result IS 'Individual result from OpenAI GPT-5 Nano model (sentiment, ideology, sentimentScore, keywords)';