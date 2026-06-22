
-- SEO verification codes (Google Search Console, Bing, etc.)
CREATE TABLE public.seo_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text UNIQUE NOT NULL,
  code text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seo_verifications TO anon, authenticated;
GRANT ALL ON public.seo_verifications TO service_role;
ALTER TABLE public.seo_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seo_verifications public read" ON public.seo_verifications FOR SELECT USING (true);
CREATE POLICY "seo_verifications admin write" ON public.seo_verifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Tracking pixels / analytics IDs
CREATE TABLE public.seo_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text UNIQUE NOT NULL,
  tracking_id text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seo_tracking TO anon, authenticated;
GRANT ALL ON public.seo_tracking TO service_role;
ALTER TABLE public.seo_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seo_tracking public read" ON public.seo_tracking FOR SELECT USING (enabled = true);
CREATE POLICY "seo_tracking admin read all" ON public.seo_tracking FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "seo_tracking admin write" ON public.seo_tracking FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Cache for sitemap.xml / robots.txt content (managed via admin UI / edge function)
CREATE TABLE public.seo_artifacts (
  id text PRIMARY KEY,
  content text NOT NULL,
  url_count int,
  generated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.seo_artifacts TO anon, authenticated;
GRANT ALL ON public.seo_artifacts TO service_role;
ALTER TABLE public.seo_artifacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seo_artifacts public read" ON public.seo_artifacts FOR SELECT USING (true);
CREATE POLICY "seo_artifacts admin write" ON public.seo_artifacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
