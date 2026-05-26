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
  -- Semantic theme dictionary: theme name + regex of synonyms/related terms
  theme_dict(theme, pattern) AS (
    VALUES
      ('Economia',      '(econom|inflaç|desemprego|emprego|salári|pib|imposto|tribut|juros?|selic|dólar|dolar|mercado|fiscal|orçament|reforma trib|gasolina|combustív|preço|carestia|pobreza|renda|bolsa famíli|auxíli)'),
      ('Segurança',     '(segurança|violênci|polícia|policia|crime|bandid|armas?|porte de arma|narcotráfic|tráfic|homicíd|assalt|roubo|facç|milíci|pcc|cv)'),
      ('Educação',      '(educaç|escola|universidad|professor|aluno|enem|fies|prouni|creche|analfabet|ensino)'),
      ('Saúde',         '(saúde|sus|hospital|médic|vacin|doenç|pandemi|covid|posto de saúde|farmáci|remédi|dengue)'),
      ('Eleições',      '(eleiç|voto|candidat|urna|campanha|partido|tse|coligaç|debate|pesquisa eleitoral|datafolha|quaest|ipec)'),
      ('Corrupção',     '(corrupç|propina|desvio|lava jato|fraud|peculato|escândal|cpmi|cpi)'),
      ('Meio Ambiente', '(meio ambient|amazôni|amazonia|desmatament|climátic|sustentab|queimad|garimpo|indígen|cop\d+)'),
      ('Direitos',      '(direitos humanos|lgbt|lgbtq|racism|negros?|mulher|feminis|aborto|igualdade|minoria)'),
      ('Religião',      '(igreja|cristã|cristao|evangéli|católic|deus|pastor|padre|fé|religi)'),
      ('Infraestrutura',('(infraestrutur|obras|estrada|rodovi|ponte|saneament|transport|metrô|metro|ônibus|onibus|mobilidade)')),
      ('Tecnologia',    '(tecnolog|inteligência artificial|ia\b|inovaç|startup|digital|internet|5g|cibern)'),
      ('Trabalho',      '(trabalh|clt|carteira assinada|sindicat|greve|terceirizaç|reforma trabal)'),
      ('Agronegócio',   '(agro|agronegóci|fazend|soja|pecuári|produtor rural|mst|reforma agrári)')
  ),
  -- Each interaction can match MULTIPLE themes (semantic grouping over full text)
  topic_matches AS (
    SELECT td.theme, c.sent
    FROM cur c
    JOIN theme_dict td ON c.comment_text ~* td.pattern
    WHERE c.comment_text IS NOT NULL
  ),
  topic_prev AS (
    SELECT td.theme, count(*) AS prev_mentions
    FROM prev p
    JOIN theme_dict td ON p.comment_text ~* td.pattern
    WHERE p.comment_text IS NOT NULL
    GROUP BY td.theme
  ),
  topics AS (
    SELECT tm.theme,
      count(*) AS mentions,
      count(*) FILTER (WHERE sent='positive') AS pos,
      count(*) FILTER (WHERE sent='negative') AS neg,
      count(*) FILTER (WHERE sent='neutral')  AS neu,
      COALESCE((SELECT prev_mentions FROM topic_prev tp WHERE tp.theme = tm.theme), 0) AS prev_mentions
    FROM topic_matches tm
    GROUP BY tm.theme
    ORDER BY mentions DESC
  ),
  -- Hashtag groups: explicit hashtags + implicit (theme-based) — grouped semantically
  explicit_tags AS (
    SELECT lower(m[1]) AS raw_tag, c.sent
    FROM cur c, regexp_matches(coalesce(c.comment_text,''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  explicit_tags_prev AS (
    SELECT lower(m[1]) AS raw_tag
    FROM prev p, regexp_matches(coalesce(p.comment_text,''), '#([[:alnum:]_]{2,})', 'g') AS m
  ),
  -- Normalize variants: strip year suffixes / common country suffixes
  tag_norm AS (
    SELECT
      regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag,
      sent
    FROM explicit_tags
  ),
  tag_norm_prev AS (
    SELECT regexp_replace(regexp_replace(raw_tag, '(brasil|br|2024|2025|2026|2027|2028|oficial)$', ''), '_+$', '') AS tag
    FROM explicit_tags_prev
  ),
  explicit_grouped AS (
    SELECT tag,
      count(*) AS mentions,
      count(*) FILTER (WHERE sent='positive') AS pos,
      count(*) FILTER (WHERE sent='negative') AS neg,
      count(*) FILTER (WHERE sent='neutral')  AS neu,
      (SELECT count(*) FROM tag_norm_prev tp WHERE tp.tag = tn.tag) AS prev_mentions
    FROM tag_norm tn
    WHERE length(tag) >= 2
    GROUP BY tag
  ),
  -- Implicit hashtags: convert detected themes into #hashtag form
  implicit_grouped AS (
    SELECT lower(theme) AS tag, mentions, pos, neg, neu, prev_mentions
    FROM topics
  ),
  hashtags_all AS (
    SELECT tag, mentions, pos, neg, neu, prev_mentions FROM explicit_grouped
    UNION ALL
    SELECT tag, mentions, pos, neg, neu, prev_mentions FROM implicit_grouped
  ),
  hashtags AS (
    SELECT '#' || tag AS tag,
      sum(mentions)::bigint AS c,
      sum(pos)::bigint AS pos,
      sum(neg)::bigint AS neg,
      sum(neu)::bigint AS neu,
      sum(prev_mentions)::bigint AS prev_c
    FROM hashtags_all
    GROUP BY tag
    ORDER BY c DESC
    LIMIT 20
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