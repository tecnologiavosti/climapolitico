-- ============================================================================
-- C3: Lista única de redes visíveis em TODAS as telas
-- ============================================================================
CREATE OR REPLACE FUNCTION public.nv_visible_networks()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  -- Redes exibidas ao usuário. Excluídas: mastodon/lemmy/pinterest/gdelt (apoio
  -- interno) e 4chan/tumblr/wikipedia/invidious (ruído / volume baixo).
  SELECT ARRAY[
    'youtube','twitter','facebook','instagram','tiktok','telegram',
    'linkedin','bluesky','reddit','google_news','threads'
  ]::text[];
$$;

-- ============================================================================
-- C2: Carimbo canônico — single source of truth para janela temporal
-- ============================================================================
CREATE OR REPLACE FUNCTION public.nv_canonical_timestamp(
  _original_posted_at timestamptz,
  _collected_at timestamptz,
  _created_at timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(_original_posted_at, _collected_at, _created_at);
$$;

-- ============================================================================
-- A2: Tabela dinâmica de palavras-chave NÃO políticas
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.non_political_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL UNIQUE,
  category text NOT NULL DEFAULT 'general',
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.non_political_keywords TO authenticated;
GRANT ALL ON public.non_political_keywords TO service_role;

ALTER TABLE public.non_political_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read non political keywords" ON public.non_political_keywords;
CREATE POLICY "Authenticated can read non political keywords"
  ON public.non_political_keywords FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins manage non political keywords" ON public.non_political_keywords;
CREATE POLICY "Admins manage non political keywords"
  ON public.non_political_keywords FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_npk_updated ON public.non_political_keywords;
CREATE TRIGGER trg_npk_updated BEFORE UPDATE ON public.non_political_keywords
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

INSERT INTO public.non_political_keywords (keyword, category) VALUES
  ('futebol','esporte'),('neymar','esporte'),('cristiano ronaldo','esporte'),
  ('al nassr','esporte'),('palmeiras','esporte'),('corinthians','esporte'),
  ('flamengo','esporte'),('vasco','esporte'),('gremio','esporte'),
  ('grêmio','esporte'),('botafogo','esporte'),('libertadores','esporte'),
  ('campeonato','esporte'),('esporte','esporte'),('esportes','esporte'),
  ('celebridade','entretenimento'),('humor','entretenimento'),
  ('meme','entretenimento'),('entretenimento','entretenimento'),
  ('novela','entretenimento'),('bbb','entretenimento'),
  ('games','entretenimento'),('gameplay','entretenimento'),
  ('musica','entretenimento'),('música','entretenimento'),
  ('show','entretenimento'),('cantor','entretenimento'),
  ('atriz','entretenimento'),('ator','entretenimento'),
  ('gospel','entretenimento'),('funk','entretenimento'),
  ('sertanej','entretenimento'),('kpop','entretenimento')
ON CONFLICT (keyword) DO NOTHING;

-- Helper SQL para montar regex a partir da tabela
CREATE OR REPLACE FUNCTION public.nv_non_political_regex()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    '(' || string_agg(regexp_replace(keyword, '([.()|\\\\^$*+?\\[\\]{}])', '\\\\\\1', 'g'), '|') || ')',
    '(__never_match__)'
  )
  FROM public.non_political_keywords
  WHERE active = true;
$$;

-- ============================================================================
-- A1 + A2 + C3: Atualiza network_view_top_posts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.network_view_top_posts(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := current_date::timestamptz - (v_days - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_cache_key text;
  v_cached jsonb;
  v_data jsonb;
  v_visible text[] := public.nv_visible_networks();
  v_blocklist text := public.nv_non_political_regex();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  v_cache_key := md5(concat_ws('|','nv_top_endpoint_v3', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count = hit_count + 1, last_hit_at = now() WHERE cache_key = v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH recent AS MATERIALIZED (
    SELECT
      si.id,
      si.social_network,
      si.comment_text,
      si.comment_author,
      COALESCE(si.sentiment_label,'Neutro') AS sent,
      (COALESCE(si.likes_count,0) + COALESCE(si.replies_count,0) + COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) AS canonical_at,
      si.original_posted_at,
      si.collected_at,
      si.post_url,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key,
      COALESCE(si.political_relevance_score,0) AS political_relevance
    FROM public.social_interactions si
    WHERE public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) >= v_since
      AND public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) = ANY (v_visible)
      AND si.comment_text IS NOT NULL
    ORDER BY public.nv_canonical_timestamp(si.original_posted_at, si.collected_at, si.created_at) DESC
    LIMIT 2000
  ), political AS (
    SELECT * FROM recent
    WHERE political_relevance >= 5
      AND public.nv_clean_text(comment_text) !~* v_blocklist
  ), deduped AS (
    SELECT DISTINCT ON (dedup_key) *
    FROM political
    ORDER BY dedup_key, eng DESC, political_relevance DESC, canonical_at DESC
  ), ranked AS (
    SELECT *, (ln(greatest(eng,0) + 1) * greatest(political_relevance::numeric / 10.0, 0.1)) AS score
    FROM deduped
    ORDER BY score DESC, canonical_at DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'top_posts',
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'social_network', social_network, 'comment_text', comment_text,
      'comment_author', comment_author, 'sent', sent, 'eng', eng,
      'likes', likes, 'replies', replies, 'shares', shares,
      'original_posted_at', canonical_at,
      'collected_at', collected_at, 'post_url', post_url
    )), '[]'::jsonb)
  ) INTO v_data
  FROM ranked;

  INSERT INTO public.network_view_cache (cache_key, result, expires_at, created_at, last_hit_at)
  VALUES (v_cache_key, v_data, now() + interval '5 minutes', now(), now())
  ON CONFLICT (cache_key) DO UPDATE SET result = EXCLUDED.result, expires_at = EXCLUDED.expires_at, last_hit_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'data', v_data,
    'diagnostics', jsonb_build_object(
      'cache_hit', false,
      'duration_ms', EXTRACT(MILLISECOND FROM (clock_timestamp() - v_started))::int,
      'relevance_threshold', 5,
      'visible_networks', v_visible
    )
  );
END;
$function$;

-- ============================================================================
-- C1: overview_summary — agregação completa via daily_network_metrics
-- ============================================================================
CREATE OR REPLACE FUNCTION public.overview_summary(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_since date := current_date - (v_days - 1);
  v_visible text[] := public.nv_visible_networks();
  v_kpis jsonb;
  v_by_network jsonb;
  v_by_candidate jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  SELECT jsonb_build_object(
    'total', COALESCE(sum(mentions),0),
    'authors', COALESCE(sum(unique_authors),0),
    'engagement', COALESCE(sum(engagement),0),
    'pos', COALESCE(sum(positive_count),0),
    'neg', COALESCE(sum(negative_count),0),
    'neu', COALESCE(sum(neutral_count),0)
  ) INTO v_kpis
  FROM public.daily_network_metrics
  WHERE metric_date >= v_since AND metric_date <= current_date
    AND (v_is_admin OR user_id = v_uid)
    AND public.nv_network_key(network) = ANY (v_visible);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'network', network,
    'mentions', mentions,
    'engagement', engagement,
    'authors', authors,
    'pos', pos, 'neg', neg, 'neu', neu
  ) ORDER BY mentions DESC), '[]'::jsonb) INTO v_by_network
  FROM (
    SELECT public.nv_network_key(network) AS network,
           sum(mentions)::bigint AS mentions,
           sum(engagement)::bigint AS engagement,
           sum(unique_authors)::bigint AS authors,
           sum(positive_count)::bigint AS pos,
           sum(negative_count)::bigint AS neg,
           sum(neutral_count)::bigint AS neu
    FROM public.daily_network_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
      AND public.nv_network_key(network) = ANY (v_visible)
    GROUP BY 1
  ) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'candidate_id', candidate_id,
    'mentions', mentions,
    'engagement', engagement,
    'authors', authors,
    'pos', pos, 'neg', neg, 'neu', neu
  ) ORDER BY mentions DESC), '[]'::jsonb) INTO v_by_candidate
  FROM (
    SELECT candidate_id,
           sum(mentions)::bigint AS mentions,
           sum(engagement)::bigint AS engagement,
           sum(unique_authors)::bigint AS authors,
           sum(positive_count)::bigint AS pos,
           sum(negative_count)::bigint AS neg,
           sum(neutral_count)::bigint AS neu
    FROM public.daily_candidate_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND (v_is_admin OR user_id = v_uid)
    GROUP BY 1
    LIMIT 200
  ) x;

  RETURN jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'days', v_days,
      'since', v_since,
      'kpis', v_kpis,
      'by_network', v_by_network,
      'by_candidate', v_by_candidate
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.overview_summary(integer) TO authenticated;

-- ============================================================================
-- Invalida cache para que as novas regras valham imediatamente
-- ============================================================================
DELETE FROM public.network_view_cache;