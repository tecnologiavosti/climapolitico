-- Secure the materialized view by revoking public access
REVOKE ALL ON network_profiles_deduplicated FROM PUBLIC;
REVOKE ALL ON network_profiles_deduplicated FROM anon;
REVOKE ALL ON network_profiles_deduplicated FROM authenticated;

-- Grant access only to service role
GRANT SELECT ON network_profiles_deduplicated TO service_role;

-- Create security definer function to access the view safely
CREATE OR REPLACE FUNCTION get_network_profiles_stats(
  _user_id uuid DEFAULT NULL
)
RETURNS TABLE (
  social_network text,
  unique_profiles bigint,
  total_profiles bigint,
  profile_location_state text,
  analyses_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user has access to at least one analysis
  IF _user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM candidate_analyses WHERE user_id = _user_id
  ) AND NOT has_role(_user_id, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Unauthorized access';
  END IF;

  -- Return aggregated data
  RETURN QUERY
  SELECT 
    npd.social_network,
    npd.unique_profiles,
    npd.total_profiles,
    npd.profile_location_state,
    npd.analyses_count
  FROM network_profiles_deduplicated npd;
END;
$$;