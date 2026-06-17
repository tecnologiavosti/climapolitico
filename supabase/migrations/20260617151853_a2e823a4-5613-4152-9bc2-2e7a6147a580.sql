
CREATE TABLE public.historical_social_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid,
  candidate_name text NOT NULL,
  candidate_name_normalized text NOT NULL,
  source text NOT NULL,
  network text NOT NULL,
  url text,
  title text,
  content text,
  date timestamptz,
  engagement integer,
  likes integer,
  comments integer,
  shares integer,
  sentiment numeric,
  sentiment_label text,
  entities jsonb,
  topics jsonb,
  hashtags jsonb,
  raw jsonb,
  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX historical_social_mentions_dedup
  ON public.historical_social_mentions (candidate_name_normalized, source, md5(coalesce(url, title, '')));

CREATE INDEX historical_social_mentions_lookup
  ON public.historical_social_mentions (candidate_name_normalized, date DESC);

CREATE INDEX historical_social_mentions_network
  ON public.historical_social_mentions (candidate_name_normalized, network, date DESC);

GRANT SELECT ON public.historical_social_mentions TO authenticated;
GRANT ALL ON public.historical_social_mentions TO service_role;

ALTER TABLE public.historical_social_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read historical social mentions"
  ON public.historical_social_mentions
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TABLE public.historical_social_collector_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid,
  candidate_name text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  inserted_count integer NOT NULL DEFAULT 0,
  source_count integer NOT NULL DEFAULT 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.historical_social_collector_runs TO authenticated;
GRANT ALL ON public.historical_social_collector_runs TO service_role;
ALTER TABLE public.historical_social_collector_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read collector runs"
  ON public.historical_social_collector_runs
  FOR SELECT TO authenticated USING (true);
