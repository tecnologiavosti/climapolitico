-- Create a candidate metrics cache table for pre-calculated, user-scoped metrics
CREATE TABLE public.candidate_metrics_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  
  -- Core metrics from social_interactions
  total_mentions INTEGER NOT NULL DEFAULT 0,
  unique_authors INTEGER NOT NULL DEFAULT 0,
  total_engagement INTEGER NOT NULL DEFAULT 0,
  total_likes INTEGER NOT NULL DEFAULT 0,
  total_replies INTEGER NOT NULL DEFAULT 0,
  total_shares INTEGER NOT NULL DEFAULT 0,
  
  -- Sentiment metrics
  positive_count INTEGER NOT NULL DEFAULT 0,
  neutral_count INTEGER NOT NULL DEFAULT 0,
  negative_count INTEGER NOT NULL DEFAULT 0,
  average_sentiment NUMERIC DEFAULT 50,
  
  -- Network breakdown (JSON for flexibility)
  network_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Reach (from candidates.followers)
  followers_count TEXT DEFAULT NULL,
  
  -- Metadata
  last_calculated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Unique constraint: one cache entry per user+candidate
  CONSTRAINT unique_user_candidate_cache UNIQUE (user_id, candidate_id)
);

-- Enable RLS
ALTER TABLE public.candidate_metrics_cache ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only see/manage their own cache
CREATE POLICY "Users can view their own metrics cache"
ON public.candidate_metrics_cache
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own metrics cache"
ON public.candidate_metrics_cache
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own metrics cache"
ON public.candidate_metrics_cache
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own metrics cache"
ON public.candidate_metrics_cache
FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all metrics cache"
ON public.candidate_metrics_cache
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for fast lookups
CREATE INDEX idx_candidate_metrics_cache_user_candidate 
ON public.candidate_metrics_cache(user_id, candidate_id);

CREATE INDEX idx_candidate_metrics_cache_candidate 
ON public.candidate_metrics_cache(candidate_id);

-- Trigger for updated_at
CREATE TRIGGER update_candidate_metrics_cache_updated_at
BEFORE UPDATE ON public.candidate_metrics_cache
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();