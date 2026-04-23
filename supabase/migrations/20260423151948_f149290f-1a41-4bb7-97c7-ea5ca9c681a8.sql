CREATE TABLE public.candidate_social_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id UUID NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook','twitter','youtube','tiktok','telegram','reddit','other')),
  url TEXT NOT NULL,
  handle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, platform, url)
);

CREATE INDEX idx_candidate_social_links_candidate ON public.candidate_social_links(candidate_id);
CREATE INDEX idx_candidate_social_links_user ON public.candidate_social_links(user_id);
CREATE INDEX idx_candidate_social_links_platform ON public.candidate_social_links(platform);

ALTER TABLE public.candidate_social_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own candidate links"
  ON public.candidate_social_links FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own candidate links"
  ON public.candidate_social_links FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own candidate links"
  ON public.candidate_social_links FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own candidate links"
  ON public.candidate_social_links FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_candidate_social_links_updated
  BEFORE UPDATE ON public.candidate_social_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();