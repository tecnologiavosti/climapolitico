-- ============ apify_runs ============
CREATE TABLE public.apify_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook')),
  actor_id TEXT NOT NULL,
  run_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','finished','failed','timeout')),
  items_collected INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_apify_runs_status ON public.apify_runs(status);
CREATE INDEX idx_apify_runs_user ON public.apify_runs(user_id);
CREATE INDEX idx_apify_runs_candidate ON public.apify_runs(candidate_id);

ALTER TABLE public.apify_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own apify_runs"
  ON public.apify_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Inserts/updates feitos pelo service role no backend (nenhuma policy = bloqueado para client)

-- ============ social_posts ============
CREATE TABLE public.social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  apify_run_id UUID REFERENCES public.apify_runs(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook')),
  post_id TEXT,
  author TEXT,
  content TEXT,
  likes INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  shares_count INTEGER NOT NULL DEFAULT 0,
  url TEXT,
  posted_at TIMESTAMPTZ,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL DEFAULT 'post' CHECK (type IN ('post','comment')),
  UNIQUE (platform, post_id)
);

CREATE INDEX idx_social_posts_candidate ON public.social_posts(candidate_id);
CREATE INDEX idx_social_posts_platform ON public.social_posts(platform);
CREATE INDEX idx_social_posts_posted_at ON public.social_posts(posted_at DESC);
CREATE INDEX idx_social_posts_user ON public.social_posts(user_id);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own social_posts"
  ON public.social_posts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));