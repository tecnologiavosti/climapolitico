
-- Tabela para armazenar agregações históricas de menções por candidato/data/plataforma
CREATE TABLE IF NOT EXISTS public.historical_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.candidates(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  date date NOT NULL,
  platform text NOT NULL DEFAULT 'unknown',
  mentions integer NOT NULL DEFAULT 0,
  engagement integer NOT NULL DEFAULT 0,
  sentiment_positive integer NOT NULL DEFAULT 0,
  sentiment_negative integer NOT NULL DEFAULT 0,
  sentiment_neutral integer NOT NULL DEFAULT 0,
  themes text[] NOT NULL DEFAULT '{}',
  region text,
  source text NOT NULL DEFAULT 'historical_fetch',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, date, platform, source)
);

CREATE INDEX IF NOT EXISTS idx_historical_mentions_candidate_date
  ON public.historical_mentions (candidate_id, date);
CREATE INDEX IF NOT EXISTS idx_historical_mentions_user
  ON public.historical_mentions (user_id);

ALTER TABLE public.historical_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own historical_mentions"
  ON public.historical_mentions FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users insert own historical_mentions"
  ON public.historical_mentions FOR INSERT
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users update own historical_mentions"
  ON public.historical_mentions FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users delete own historical_mentions"
  ON public.historical_mentions FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- RPC: agrega um período combinando social_interactions + historical_mentions
CREATE OR REPLACE FUNCTION public.get_historical_period_aggregate(
  _user_id uuid,
  _candidate_id uuid,
  _period_start timestamptz,
  _period_end timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH si AS (
    SELECT
      coalesce(s.collected_at, s.created_at)::date AS d,
      lower(coalesce(s.social_network,'outro')) AS platform,
      coalesce(s.region,'Indefinida') AS region,
      coalesce(s.likes_count,0) + coalesce(s.replies_count,0) + coalesce(s.shares_count,0) AS engagement,
      CASE WHEN s.sentiment_label IN ('Positivo','positive','POSITIVE') THEN 1 ELSE 0 END AS pos,
      CASE WHEN s.sentiment_label IN ('Negativo','negative','NEGATIVE') THEN 1 ELSE 0 END AS neg,
      CASE WHEN s.sentiment_label IN ('Neutro','neutral','NEUTRAL') THEN 1 ELSE 0 END AS neu,
      lower(coalesce(s.comment_text,'')) AS txt
    FROM public.social_interactions s
    WHERE s.candidate_id = _candidate_id
      AND (v_is_admin OR s.user_id = _user_id)
      AND coalesce(s.collected_at, s.created_at) >= _period_start
      AND coalesce(s.collected_at, s.created_at) <= _period_end
  ), hm AS (
    SELECT
      h.date AS d,
      lower(h.platform) AS platform,
      coalesce(h.region,'Indefinida') AS region,
      h.engagement,
      h.sentiment_positive AS pos,
      h.sentiment_negative AS neg,
      h.sentiment_neutral AS neu,
      h.mentions,
      h.themes
    FROM public.historical_mentions h
    WHERE h.candidate_id = _candidate_id
      AND (v_is_admin OR h.user_id = _user_id)
      AND h.date >= _period_start::date
      AND h.date <= _period_end::date
  ), themes_si AS (
    SELECT theme, count(*)::bigint AS hits FROM (
      SELECT CASE
        WHEN txt ~ '(economia|emprego|inflação|preço|renda|salário|juros|pib|custo de vida)' THEN 'Economia'
        WHEN txt ~ '(segurança|crime|violência|polícia|tráfico|assalto|homicídio)' THEN 'Segurança pública'
        WHEN txt ~ '(saúde|hospital|sus|médico|vacina|remédio)' THEN 'Saúde'
        WHEN txt ~ '(educação|escola|professor|aluno|ensino|universidade|enem)' THEN 'Educação'
        WHEN txt ~ '(corrupção|propina|desvio|fraude|rachadinha|lava jato)' THEN 'Corrupção'
        WHEN txt ~ '(imposto|tributo|taxa|arrecadação)' THEN 'Impostos'
        WHEN txt ~ '(meio ambiente|amazônia|clima|desmatamento|queimada|enchente)' THEN 'Meio ambiente'
        WHEN txt ~ '(bolsa família|auxílio|benefício|pobreza|fome|cadúnico)' THEN 'Programas sociais'
        ELSE NULL END AS theme
      FROM si
    ) t WHERE theme IS NOT NULL GROUP BY theme
  ), themes_hm AS (
    SELECT unnest(themes) AS theme, sum(mentions)::bigint AS hits
    FROM hm WHERE themes IS NOT NULL AND array_length(themes,1) > 0
    GROUP BY 1
  ), themes_all AS (
    SELECT theme, sum(hits)::bigint AS hits FROM (
      SELECT * FROM themes_si UNION ALL SELECT * FROM themes_hm
    ) u GROUP BY theme ORDER BY hits DESC LIMIT 6
  ), regions_all AS (
    SELECT region, sum(c)::bigint AS hits FROM (
      SELECT region, 1::bigint AS c FROM si
      UNION ALL
      SELECT region, mentions::bigint AS c FROM hm
    ) u GROUP BY region ORDER BY hits DESC LIMIT 6
  ), platforms_all AS (
    SELECT platform, sum(c)::bigint AS hits FROM (
      SELECT platform, 1::bigint AS c FROM si
      UNION ALL
      SELECT platform, mentions::bigint AS c FROM hm
    ) u GROUP BY platform ORDER BY hits DESC LIMIT 12
  ), daily AS (
    SELECT d, sum(c)::bigint AS mentions FROM (
      SELECT d, 1::bigint AS c FROM si
      UNION ALL
      SELECT d, mentions::bigint AS c FROM hm
    ) u GROUP BY d ORDER BY d
  ), totals AS (
    SELECT
      (SELECT count(*) FROM si) + coalesce((SELECT sum(mentions) FROM hm),0) AS total_mentions,
      (SELECT coalesce(sum(engagement),0) FROM si) + coalesce((SELECT sum(engagement) FROM hm),0) AS total_engagement,
      (SELECT coalesce(sum(pos),0) FROM si) + coalesce((SELECT sum(pos) FROM hm),0) AS pos,
      (SELECT coalesce(sum(neg),0) FROM si) + coalesce((SELECT sum(neg) FROM hm),0) AS neg,
      (SELECT coalesce(sum(neu),0) FROM si) + coalesce((SELECT sum(neu) FROM hm),0) AS neu,
      (SELECT count(*) FROM si) AS realtime_records,
      coalesce((SELECT sum(mentions) FROM hm),0) AS historical_records
  )
  SELECT jsonb_build_object(
    'totalMentions', t.total_mentions,
    'totalEngagement', t.total_engagement,
    'sentimentPositive', t.pos,
    'sentimentNegative', t.neg,
    'sentimentNeutral', t.neu,
    'realtimeRecords', t.realtime_records,
    'historicalRecords', t.historical_records,
    'dominantThemes', coalesce((SELECT jsonb_agg(jsonb_build_object('theme', theme, 'mentions', hits)) FROM themes_all), '[]'::jsonb),
    'regions', coalesce((SELECT jsonb_agg(jsonb_build_object('region', region, 'mentions', hits)) FROM regions_all), '[]'::jsonb),
    'platforms', coalesce((SELECT jsonb_agg(jsonb_build_object('platform', platform, 'mentions', hits)) FROM platforms_all), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', d, 'mentions', mentions) ORDER BY d) FROM daily), '[]'::jsonb)
  )
  INTO v_result FROM totals t;

  RETURN coalesce(v_result, '{}'::jsonb);
END;
$$;
