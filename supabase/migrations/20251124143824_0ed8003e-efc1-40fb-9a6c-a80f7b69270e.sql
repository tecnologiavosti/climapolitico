-- Add profile_global_id to analysis_sources for cross-platform deduplication
ALTER TABLE analysis_sources 
ADD COLUMN IF NOT EXISTS profile_global_id text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_analysis_sources_profile_global_id 
ON analysis_sources(profile_global_id);

-- Create unique_profiles table for cross-platform tracking
CREATE TABLE IF NOT EXISTS unique_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  global_profile_id text UNIQUE NOT NULL,
  profile_username text NOT NULL,
  platforms jsonb DEFAULT '[]'::jsonb,
  total_appearances integer DEFAULT 1,
  first_seen_at timestamp with time zone DEFAULT now(),
  last_seen_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS on unique_profiles
ALTER TABLE unique_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view unique profiles from their analyses
CREATE POLICY "Users can view unique profiles from their analyses"
ON unique_profiles FOR SELECT
USING (
  global_profile_id IN (
    SELECT DISTINCT profile_global_id 
    FROM analysis_sources 
    WHERE analysis_id IN (
      SELECT id FROM candidate_analyses WHERE user_id = auth.uid()
    )
  )
);

-- System can insert unique profiles
CREATE POLICY "System can insert unique profiles"
ON unique_profiles FOR INSERT
WITH CHECK (true);

-- System can update unique profiles
CREATE POLICY "System can update unique profiles"
ON unique_profiles FOR UPDATE
USING (true);

-- Admins can view all unique profiles
CREATE POLICY "Admins can view all unique profiles"
ON unique_profiles FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create materialized view for fast aggregation
CREATE MATERIALIZED VIEW IF NOT EXISTS network_profiles_deduplicated AS
SELECT 
  social_network,
  COUNT(DISTINCT profile_global_id) as unique_profiles,
  COUNT(*) as total_profiles,
  profile_location_state,
  COUNT(DISTINCT analysis_id) as analyses_count
FROM analysis_sources
WHERE profile_global_id IS NOT NULL
GROUP BY social_network, profile_location_state;

-- Create index on materialized view
CREATE UNIQUE INDEX IF NOT EXISTS idx_network_profiles_deduplicated 
ON network_profiles_deduplicated(social_network, COALESCE(profile_location_state, 'unknown'));

-- Create function to refresh materialized view
CREATE OR REPLACE FUNCTION refresh_network_profiles_deduplicated()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY network_profiles_deduplicated;
END;
$$;