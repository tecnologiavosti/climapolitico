
CREATE OR REPLACE FUNCTION public.network_view_aggregate(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(v_uid, 'admin'::app_role);
  v_since timestamptz := now() - make_interval(days => p_days);
  v_prev_since timestamptz := now() - make_interval(days => p_days * 2);
  v_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH base AS (
    SELECT
      si.id, si.social_network, si.comment_text, si.comment_author,
      COALESCE(si.likes_count,0) AS likes,
      COALESCE(si.replies_count,0) AS replies,
      COALESCE(si.shares_count,0) AS shares,
      CASE lower(si.sentiment_label)
        WHEN 'positivo' THEN 'positive'
        WHEN 'positive' THEN 'positive'
        WHEN 'negativo' THEN 'negative'
        WHEN 'negative' THEN 'negative'
        WHEN 'neutro' THEN 'neutral'
        WHEN 'neutral' THEN 'neutral'
        ELSE NULL
      END AS sent,
      si.collected_at, si.original_posted_at
    FROM social_interactions si
    WHERE si.collected_at >= v_prev_since
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (p_network IS NULL OR p_network = 'all' OR si.social_network = p_network)
      AND si.social_network NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ),
  cur AS (SELECT * FROM base WHERE collected_at >= v_since),
  prev AS (SELECT * FROM base WHERE collected_at < v_since),
  kpis AS (
    SELECT
      (SELECT count(*) FROM cur) AS total,
      (SELECT count(DISTINCT comment_author) FROM cur WHERE comment_author IS NOT NULL) AS authors,
      (SELECT coalesce(sum(likes+replies+shares),0) FROM cur) AS engagement,
      (SELECT coalesce(sum(likes),0) FROM cur) AS likes,
      (SELECT coalesce(sum(replies),0) FROM cur) AS replies,
      (SELECT coalesce(sum(shares),0) FROM cur) AS shares,
      (SELECT count(*) FROM cur WHERE sent='positive') AS pos,
      (SELECT count(*) FROM cur WHERE sent='negative') AS neg,
      (SELECT count(*) FROM cur WHERE sent='neutral') AS neu,
      (SELECT count(*) FROM prev) AS prev_total,
      (SELECT count(*) FROM prev WHERE sent='positive') AS prev_pos,
      (SELECT count(*) FROM prev WHERE sent='negative') AS prev_neg,
      (SELECT count(*) FROM prev WHERE sent='neutral') AS prev_neu
  ),
  series AS (
    SELECT to_char(date_trunc('day', collected_at), 'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent='positive') AS p,
      count(*) FILTER (WHERE sent='negative') AS n,
      count(*) FILTER (WHERE sent='neutral')  AS u
    FROM cur GROUP BY 1 ORDER BY 1
  ),
  by_net AS (
    SELECT social_network AS network,
      count(*) AS mentions,
      coalesce(sum(likes),0) AS likes,
      coalesce(sum(replies),0) AS replies,
      coalesce(sum(shares),0) AS shares,
      coalesce(sum(likes+replies+shares),0) AS engagement
    FROM cur GROUP BY 1 ORDER BY engagement DESC
  ),
  heat AS (
    SELECT extract(dow FROM coalesce(original_posted_at, collected_at))::int AS dow,
      extract(hour FROM coalesce(original_posted_at, collected_at))::int AS hr,
      count(*) AS c
    FROM cur GROUP BY 1,2
  ),
  hashtags AS (
    SELECT lower(tag) AS tag, count(*) AS c
    FROM cur, regexp_matches(coalesce(comment_text,''), '#[[:alnum:]_]{2,}', 'g') AS m(tag_arr),
    LATERAL (SELECT tag_arr[1] AS tag) t
    GROUP BY 1 ORDER BY c DESC LIMIT 15
  ),
  topics AS (
    SELECT theme, count(*) AS mentions,
      count(*) FILTER (WHERE sent='positive') AS pos,
      count(*) FILTER (WHERE sent='negative') AS neg,
      count(*) FILTER (WHERE sent='neutral') AS neu
    FROM (
      SELECT sent,
        CASE
          WHEN comment_text ~* '(econom|inflação|desemprego|salário|pib|imposto|tribut)' THEN 'Economia'
          WHEN comment_text ~* '(segurança|violência|polícia|crime|bandido|armas?)' THEN 'Segurança'
          WHEN comment_text ~* '(educação|escola|universidade|professor|aluno|enem)' THEN 'Educação'
          WHEN comment_text ~* '(saúde|sus|hospital|médico|vacina|doença)' THEN 'Saúde'
          WHEN comment_text ~* '(eleiç|voto|candidat|urna|campanha|partido)' THEN 'Eleições'
          WHEN comment_text ~* '(corrupç|propina|desvio|lava jato|fraud)' THEN 'Corrupção'
          WHEN comment_text ~* '(meio ambient|amazônia|desmatament|climática?)' THEN 'Meio Ambiente'
          ELSE NULL
        END AS theme
      FROM cur
    ) t
    WHERE theme IS NOT NULL
    GROUP BY theme ORDER BY mentions DESC
  ),
  top_posts AS (
    SELECT id, social_network, comment_text, comment_author, sent,
      (likes+replies+shares) AS eng,
      likes, replies, shares, original_posted_at, collected_at
    FROM cur
    WHERE comment_text IS NOT NULL AND length(comment_text) > 0
    ORDER BY (likes+replies+shares) DESC NULLS LAST
    LIMIT 5
  )
  SELECT jsonb_build_object(
    'kpis', (SELECT to_jsonb(kpis.*) FROM kpis),
    'series', (SELECT coalesce(jsonb_agg(to_jsonb(series.*)), '[]'::jsonb) FROM series),
    'by_network', (SELECT coalesce(jsonb_agg(to_jsonb(by_net.*)), '[]'::jsonb) FROM by_net),
    'heatmap', (SELECT coalesce(jsonb_agg(to_jsonb(heat.*)), '[]'::jsonb) FROM heat),
    'hashtags', (SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*)), '[]'::jsonb) FROM hashtags),
    'topics', (SELECT coalesce(jsonb_agg(to_jsonb(topics.*)), '[]'::jsonb) FROM topics),
    'top_posts', (SELECT coalesce(jsonb_agg(to_jsonb(top_posts.*)), '[]'::jsonb) FROM top_posts)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.network_view_aggregate(uuid, text, integer) TO authenticated;
