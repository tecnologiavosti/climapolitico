
-- ============================================================
-- Mapa cidade/UF/região (server-side) — usado pelas duas RPCs
-- ============================================================
CREATE OR REPLACE FUNCTION public._regional_city_dict()
RETURNS TABLE(norm text, city text, uf text, region text)
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT v.norm, v.city, v.uf, v.region
  FROM (VALUES
    -- Capitais (norm = lower sem acento)
    ('rio branco','Rio Branco','AC','Norte'),
    ('maceio','Maceió','AL','Nordeste'),
    ('macapa','Macapá','AP','Norte'),
    ('manaus','Manaus','AM','Norte'),
    ('salvador','Salvador','BA','Nordeste'),
    ('fortaleza','Fortaleza','CE','Nordeste'),
    ('brasilia','Brasília','DF','Centro-Oeste'),
    ('vitoria','Vitória','ES','Sudeste'),
    ('goiania','Goiânia','GO','Centro-Oeste'),
    ('sao luis','São Luís','MA','Nordeste'),
    ('cuiaba','Cuiabá','MT','Centro-Oeste'),
    ('campo grande','Campo Grande','MS','Centro-Oeste'),
    ('belo horizonte','Belo Horizonte','MG','Sudeste'),
    ('belem','Belém','PA','Norte'),
    ('joao pessoa','João Pessoa','PB','Nordeste'),
    ('curitiba','Curitiba','PR','Sul'),
    ('recife','Recife','PE','Nordeste'),
    ('teresina','Teresina','PI','Nordeste'),
    ('rio de janeiro','Rio de Janeiro','RJ','Sudeste'),
    ('natal','Natal','RN','Nordeste'),
    ('porto alegre','Porto Alegre','RS','Sul'),
    ('porto velho','Porto Velho','RO','Norte'),
    ('boa vista','Boa Vista','RR','Norte'),
    ('florianopolis','Florianópolis','SC','Sul'),
    ('sao paulo','São Paulo','SP','Sudeste'),
    ('aracaju','Aracaju','SE','Nordeste'),
    ('palmas','Palmas','TO','Norte'),
    -- Metrópoles relevantes
    ('campinas','Campinas','SP','Sudeste'),
    ('guarulhos','Guarulhos','SP','Sudeste'),
    ('santos','Santos','SP','Sudeste'),
    ('sorocaba','Sorocaba','SP','Sudeste'),
    ('ribeirao preto','Ribeirão Preto','SP','Sudeste'),
    ('sao bernardo do campo','São Bernardo do Campo','SP','Sudeste'),
    ('santo andre','Santo André','SP','Sudeste'),
    ('osasco','Osasco','SP','Sudeste'),
    ('sao jose dos campos','São José dos Campos','SP','Sudeste'),
    ('niteroi','Niterói','RJ','Sudeste'),
    ('duque de caxias','Duque de Caxias','RJ','Sudeste'),
    ('nova iguacu','Nova Iguaçu','RJ','Sudeste'),
    ('sao goncalo','São Gonçalo','RJ','Sudeste'),
    ('uberlandia','Uberlândia','MG','Sudeste'),
    ('contagem','Contagem','MG','Sudeste'),
    ('juiz de fora','Juiz de Fora','MG','Sudeste'),
    ('betim','Betim','MG','Sudeste'),
    ('montes claros','Montes Claros','MG','Sudeste'),
    ('londrina','Londrina','PR','Sul'),
    ('maringa','Maringá','PR','Sul'),
    ('foz do iguacu','Foz do Iguaçu','PR','Sul'),
    ('ponta grossa','Ponta Grossa','PR','Sul'),
    ('caxias do sul','Caxias do Sul','RS','Sul'),
    ('pelotas','Pelotas','RS','Sul'),
    ('canoas','Canoas','RS','Sul'),
    ('santa maria','Santa Maria','RS','Sul'),
    ('joinville','Joinville','SC','Sul'),
    ('blumenau','Blumenau','SC','Sul'),
    ('chapeco','Chapecó','SC','Sul'),
    ('itajai','Itajaí','SC','Sul'),
    ('feira de santana','Feira de Santana','BA','Nordeste'),
    ('vitoria da conquista','Vitória da Conquista','BA','Nordeste'),
    ('ilheus','Ilhéus','BA','Nordeste'),
    ('caruaru','Caruaru','PE','Nordeste'),
    ('olinda','Olinda','PE','Nordeste'),
    ('jaboatao dos guararapes','Jaboatão dos Guararapes','PE','Nordeste'),
    ('petrolina','Petrolina','PE','Nordeste'),
    ('anapolis','Anápolis','GO','Centro-Oeste'),
    ('aparecida de goiania','Aparecida de Goiânia','GO','Centro-Oeste'),
    ('varzea grande','Várzea Grande','MT','Centro-Oeste'),
    ('ananindeua','Ananindeua','PA','Norte'),
    ('santarem','Santarém','PA','Norte'),
    ('imperatriz','Imperatriz','MA','Nordeste'),
    ('mossoro','Mossoró','RN','Nordeste'),
    ('campina grande','Campina Grande','PB','Nordeste'),
    ('vila velha','Vila Velha','ES','Sudeste'),
    ('serra','Serra','ES','Sudeste'),
    ('cariacica','Cariacica','ES','Sudeste')
  ) AS v(norm, city, uf, region);
$$;

GRANT EXECUTE ON FUNCTION public._regional_city_dict() TO authenticated, service_role;

-- ============================================================
-- UF → região
-- ============================================================
CREATE OR REPLACE FUNCTION public._region_from_uf(uf text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(uf)
    WHEN 'AC' THEN 'Norte'  WHEN 'AP' THEN 'Norte'   WHEN 'AM' THEN 'Norte'
    WHEN 'PA' THEN 'Norte'  WHEN 'RO' THEN 'Norte'   WHEN 'RR' THEN 'Norte'  WHEN 'TO' THEN 'Norte'
    WHEN 'AL' THEN 'Nordeste' WHEN 'BA' THEN 'Nordeste' WHEN 'CE' THEN 'Nordeste'
    WHEN 'MA' THEN 'Nordeste' WHEN 'PB' THEN 'Nordeste' WHEN 'PE' THEN 'Nordeste'
    WHEN 'PI' THEN 'Nordeste' WHEN 'RN' THEN 'Nordeste' WHEN 'SE' THEN 'Nordeste'
    WHEN 'DF' THEN 'Centro-Oeste' WHEN 'GO' THEN 'Centro-Oeste'
    WHEN 'MT' THEN 'Centro-Oeste' WHEN 'MS' THEN 'Centro-Oeste'
    WHEN 'ES' THEN 'Sudeste' WHEN 'MG' THEN 'Sudeste' WHEN 'RJ' THEN 'Sudeste' WHEN 'SP' THEN 'Sudeste'
    WHEN 'PR' THEN 'Sul' WHEN 'RS' THEN 'Sul' WHEN 'SC' THEN 'Sul'
    ELSE NULL END;
$$;

GRANT EXECUTE ON FUNCTION public._region_from_uf(text) TO authenticated, service_role;

-- ============================================================
-- 1) MAPA REGIONAL — agrega por região usando geo-enriquecimento
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_regional_map_summary(
  _user_id uuid,
  _candidate_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH base AS (
    SELECT
      si.id,
      si.sentiment_label,
      coalesce(si.likes_count,0)::bigint AS likes,
      coalesce(si.replies_count,0)::bigint AS replies,
      coalesce(si.shares_count,0)::bigint AS shares,
      lower(coalesce(si.social_network,'')) AS network,
      lower(coalesce(si.comment_text,'') || ' ' || coalesce(si.comment_author,'') || ' ' || coalesce(si.author_profile_url,'')) AS hay,
      si.region AS r_region,
      si.state  AS r_state,
      si.city   AS r_city,
      si.latitude, si.longitude
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND si.candidate_id = _candidate_id
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ),
  -- Priority 1+2+3: campos diretos
  step1 AS (
    SELECT b.*,
      CASE
        WHEN b.r_region IN ('Norte','Nordeste','Centro-Oeste','Sudeste','Sul') THEN b.r_region
        WHEN b.r_state IS NOT NULL THEN public._region_from_uf(b.r_state)
        ELSE NULL
      END AS reg1
    FROM base b
  ),
  -- Priority 4: cidade do dicionário no texto/autor
  city_match AS (
    SELECT s.id, d.city, d.uf, d.region
    FROM step1 s
    CROSS JOIN LATERAL (
      SELECT d.city, d.uf, d.region
      FROM public._regional_city_dict() d
      WHERE s.reg1 IS NULL
        AND s.hay ~ ('(^|[^a-z0-9])' || d.norm || '($|[^a-z0-9])')
      ORDER BY length(d.norm) DESC
      LIMIT 1
    ) d
  ),
  -- Priority 5: hashtag de UF (#sp, #bahia, etc.)
  hashtag_uf AS (
    SELECT s.id,
      (SELECT uf FROM (
        VALUES ('ac'),('al'),('ap'),('am'),('ba'),('ce'),('df'),('es'),('go'),('ma'),
               ('mt'),('ms'),('mg'),('pa'),('pb'),('pr'),('pe'),('pi'),('rj'),('rn'),
               ('rs'),('ro'),('rr'),('sc'),('sp'),('se'),('to')
      ) AS u(uf)
      WHERE s.hay ~ ('#' || u.uf || '($|[^a-z0-9])')
      LIMIT 1) AS uf
    FROM step1 s
    WHERE s.reg1 IS NULL
  ),
  resolved AS (
    SELECT
      s.id,
      coalesce(s.reg1, cm.region, public._region_from_uf(hu.uf)) AS region,
      s.sentiment_label, s.likes, s.replies, s.shares, s.network
    FROM step1 s
    LEFT JOIN city_match cm ON cm.id = s.id
    LEFT JOIN hashtag_uf hu ON hu.id = s.id
  ),
  region_agg AS (
    SELECT
      region,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos'))::bigint AS pos,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg'))::bigint AS neg,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu'))::bigint AS neu,
      coalesce(sum(likes + replies + shares),0)::bigint AS engagement
    FROM resolved
    GROUP BY region
  ),
  network_breakdown AS (
    SELECT network, count(*)::bigint AS total FROM resolved GROUP BY network
  )
  SELECT jsonb_build_object(
    'regions', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'region', region, 'total', total, 'pos', pos, 'neg', neg, 'neu', neu, 'engagement', engagement
      )) FROM region_agg WHERE region IS NOT NULL), '[]'::jsonb),
    'unclassifiedTotal', coalesce((SELECT total FROM region_agg WHERE region IS NULL), 0),
    'grandTotal', (SELECT coalesce(sum(total),0) FROM region_agg),
    'networkBreakdown', coalesce((SELECT jsonb_agg(jsonb_build_object('network', network, 'total', total) ORDER BY total DESC) FROM network_breakdown), '[]'::jsonb)
  ) INTO v_result;

  RETURN coalesce(v_result, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_regional_map_summary(uuid, uuid) TO authenticated, service_role;

-- ============================================================
-- 2) RANKING DE CIDADES — usa o mesmo geo-enriquecimento
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cities_ranking_summary(
  _user_id uuid,
  _candidate_id uuid
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH base AS (
    SELECT
      si.id, si.sentiment_label,
      coalesce(si.collected_at, si.created_at) AS at,
      lower(coalesce(si.comment_text,'') || ' ' || coalesce(si.comment_author,'') || ' ' || coalesce(si.author_profile_url,'')) AS hay,
      si.city AS r_city, si.state AS r_state
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND si.candidate_id = _candidate_id
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ),
  -- Cidade direta
  step1 AS (
    SELECT b.*,
      CASE WHEN b.r_city IS NOT NULL AND length(trim(b.r_city)) > 0 THEN b.r_city ELSE NULL END AS c1,
      CASE WHEN b.r_state IS NOT NULL AND length(trim(b.r_state)) > 0 THEN upper(b.r_state) ELSE NULL END AS uf1
    FROM base b
  ),
  -- Dicionário: cidade no texto
  city_match AS (
    SELECT s.id, d.city, d.uf
    FROM step1 s
    CROSS JOIN LATERAL (
      SELECT d.city, d.uf
      FROM public._regional_city_dict() d
      WHERE s.c1 IS NULL
        AND s.hay ~ ('(^|[^a-z0-9])' || d.norm || '($|[^a-z0-9])')
      ORDER BY length(d.norm) DESC
      LIMIT 1
    ) d
  ),
  resolved AS (
    SELECT
      s.id, s.sentiment_label, s.at,
      coalesce(s.c1, cm.city) AS city,
      coalesce(s.uf1, cm.uf) AS uf
    FROM step1 s
    LEFT JOIN city_match cm ON cm.id = s.id
  ),
  agg AS (
    SELECT
      city, uf,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos'))::bigint AS pos,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg'))::bigint AS neg,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu'))::bigint AS neu,
      count(*) FILTER (WHERE at >= now() - interval '7 days')::bigint AS recent,
      count(*) FILTER (WHERE at >= now() - interval '14 days' AND at < now() - interval '7 days')::bigint AS previous
    FROM resolved
    WHERE city IS NOT NULL
    GROUP BY city, uf
  )
  SELECT jsonb_build_object(
    'cities', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'city', city, 'uf', uf, 'total', total,
        'pos', pos, 'neg', neg, 'neu', neu,
        'recent', recent, 'previous', previous
      ) ORDER BY total DESC) FROM agg), '[]'::jsonb),
    'totalRecords', (SELECT count(*) FROM resolved),
    'withCity', (SELECT count(*) FROM resolved WHERE city IS NOT NULL),
    'withoutCity', (SELECT count(*) FROM resolved WHERE city IS NULL)
  ) INTO v_result;

  RETURN coalesce(v_result, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.get_cities_ranking_summary(uuid, uuid) TO authenticated, service_role;
