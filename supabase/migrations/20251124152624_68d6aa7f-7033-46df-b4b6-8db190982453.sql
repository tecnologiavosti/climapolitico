-- Create collection_configs table
CREATE TABLE IF NOT EXISTS collection_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE collection_configs ENABLE ROW LEVEL SECURITY;

-- Users can view their own configs
CREATE POLICY "Users can view their own configs"
ON collection_configs FOR SELECT
USING (auth.uid() = user_id);

-- Users can insert their own configs
CREATE POLICY "Users can insert their own configs"
ON collection_configs FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Users can update their own configs
CREATE POLICY "Users can update their own configs"
ON collection_configs FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own configs
CREATE POLICY "Users can delete their own configs"
ON collection_configs FOR DELETE
USING (auth.uid() = user_id);

-- Admins can view all configs
CREATE POLICY "Admins can view all configs"
ON collection_configs FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_collection_configs_user_id ON collection_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_configs_candidate_id ON collection_configs(candidate_id);
CREATE INDEX IF NOT EXISTS idx_collection_configs_status ON collection_configs(status);

-- Add trigger for updated_at
CREATE TRIGGER update_collection_configs_updated_at
BEFORE UPDATE ON collection_configs
FOR EACH ROW
EXECUTE FUNCTION handle_updated_at();