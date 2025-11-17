-- Add new columns to candidate_analyses table for demographic and social network data
ALTER TABLE public.candidate_analyses
ADD COLUMN IF NOT EXISTS social_network text,
ADD COLUMN IF NOT EXISTS region_distribution jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS age_distribution jsonb DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS gender_distribution jsonb DEFAULT '{}'::jsonb;