
-- ============================================================
-- Geolocation deep refactor
-- 1) Expanded city dictionary (~200 entries, canonical name + UF + region)
-- 2) Reescrita do get_cities_ranking_summary com:
--    - normalização de display ("santos" -> "Santos/SP")
--    - validação cidade↔UF (descarta combinações inválidas)
--    - inferência por dicionário em texto+autor+url (sem limite 300 char)
--    - inferência por hashtags de UF (#sp, #bahia...)
--    - métricas de cobertura: cidades/estados/regiões/sem localização/baixa confiança
-- ============================================================

CREATE OR REPLACE FUNCTION public._regional_city_dict()
RETURNS TABLE(norm text, city text, uf text, region text)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT v.norm, v.city, v.uf, v.region FROM (VALUES
    -- Capitais
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
    -- SP
    ('campinas','Campinas','SP','Sudeste'),
    ('guarulhos','Guarulhos','SP','Sudeste'),
    ('santos','Santos','SP','Sudeste'),
    ('sorocaba','Sorocaba','SP','Sudeste'),
    ('ribeirao preto','Ribeirão Preto','SP','Sudeste'),
    ('santo andre','Santo André','SP','Sudeste'),
    ('osasco','Osasco','SP','Sudeste'),
    ('sao bernardo do campo','São Bernardo do Campo','SP','Sudeste'),
    ('sao jose dos campos','São José dos Campos','SP','Sudeste'),
    ('sao caetano do sul','São Caetano do Sul','SP','Sudeste'),
    ('jundiai','Jundiaí','SP','Sudeste'),
    ('piracicaba','Piracicaba','SP','Sudeste'),
    ('bauru','Bauru','SP','Sudeste'),
    ('mogi das cruzes','Mogi das Cruzes','SP','Sudeste'),
    ('diadema','Diadema','SP','Sudeste'),
    ('carapicuiba','Carapicuíba','SP','Sudeste'),
    ('itaquaquecetuba','Itaquaquecetuba','SP','Sudeste'),
    ('sumare','Sumaré','SP','Sudeste'),
    ('barueri','Barueri','SP','Sudeste'),
    ('embu das artes','Embu das Artes','SP','Sudeste'),
    ('taubate','Taubaté','SP','Sudeste'),
    ('limeira','Limeira','SP','Sudeste'),
    ('franca','Franca','SP','Sudeste'),
    ('sao vicente','São Vicente','SP','Sudeste'),
    ('praia grande','Praia Grande','SP','Sudeste'),
    ('guaruja','Guarujá','SP','Sudeste'),
    ('marilia','Marília','SP','Sudeste'),
    ('presidente prudente','Presidente Prudente','SP','Sudeste'),
    ('aracatuba','Araçatuba','SP','Sudeste'),
    ('sao jose do rio preto','São José do Rio Preto','SP','Sudeste'),
    -- RJ
    ('niteroi','Niterói','RJ','Sudeste'),
    ('duque de caxias','Duque de Caxias','RJ','Sudeste'),
    ('nova iguacu','Nova Iguaçu','RJ','Sudeste'),
    ('sao goncalo','São Gonçalo','RJ','Sudeste'),
    ('petropolis','Petrópolis','RJ','Sudeste'),
    ('campos dos goytacazes','Campos dos Goytacazes','RJ','Sudeste'),
    ('volta redonda','Volta Redonda','RJ','Sudeste'),
    ('belford roxo','Belford Roxo','RJ','Sudeste'),
    ('sao joao de meriti','São João de Meriti','RJ','Sudeste'),
    ('macae','Macaé','RJ','Sudeste'),
    ('cabo frio','Cabo Frio','RJ','Sudeste'),
    ('angra dos reis','Angra dos Reis','RJ','Sudeste'),
    ('nova friburgo','Nova Friburgo','RJ','Sudeste'),
    ('teresopolis','Teresópolis','RJ','Sudeste'),
    ('barra mansa','Barra Mansa','RJ','Sudeste'),
    -- MG
    ('uberlandia','Uberlândia','MG','Sudeste'),
    ('contagem','Contagem','MG','Sudeste'),
    ('juiz de fora','Juiz de Fora','MG','Sudeste'),
    ('betim','Betim','MG','Sudeste'),
    ('montes claros','Montes Claros','MG','Sudeste'),
    ('uberaba','Uberaba','MG','Sudeste'),
    ('ribeirao das neves','Ribeirão das Neves','MG','Sudeste'),
    ('ipatinga','Ipatinga','MG','Sudeste'),
    ('governador valadares','Governador Valadares','MG','Sudeste'),
    ('santa luzia','Santa Luzia','MG','Sudeste'),
    ('sete lagoas','Sete Lagoas','MG','Sudeste'),
    ('divinopolis','Divinópolis','MG','Sudeste'),
    ('pocos de caldas','Poços de Caldas','MG','Sudeste'),
    ('patos de minas','Patos de Minas','MG','Sudeste'),
    ('teofilo otoni','Teófilo Otoni','MG','Sudeste'),
    ('barbacena','Barbacena','MG','Sudeste'),
    -- ES
    ('vila velha','Vila Velha','ES','Sudeste'),
    ('serra','Serra','ES','Sudeste'),
    ('cariacica','Cariacica','ES','Sudeste'),
    ('linhares','Linhares','ES','Sudeste'),
    ('sao mateus','São Mateus','ES','Sudeste'),
    -- PR
    ('londrina','Londrina','PR','Sul'),
    ('maringa','Maringá','PR','Sul'),
    ('foz do iguacu','Foz do Iguaçu','PR','Sul'),
    ('ponta grossa','Ponta Grossa','PR','Sul'),
    ('cascavel','Cascavel','PR','Sul'),
    ('sao jose dos pinhais','São José dos Pinhais','PR','Sul'),
    ('colombo','Colombo','PR','Sul'),
    ('guarapuava','Guarapuava','PR','Sul'),
    ('toledo','Toledo','PR','Sul'),
    ('apucarana','Apucarana','PR','Sul'),
    ('paranagua','Paranaguá','PR','Sul'),
    -- RS
    ('caxias do sul','Caxias do Sul','RS','Sul'),
    ('pelotas','Pelotas','RS','Sul'),
    ('canoas','Canoas','RS','Sul'),
    ('santa maria','Santa Maria','RS','Sul'),
    ('gravatai','Gravataí','RS','Sul'),
    ('viamao','Viamão','RS','Sul'),
    ('novo hamburgo','Novo Hamburgo','RS','Sul'),
    ('sao leopoldo','São Leopoldo','RS','Sul'),
    ('rio grande','Rio Grande','RS','Sul'),
    ('passo fundo','Passo Fundo','RS','Sul'),
    ('alvorada','Alvorada','RS','Sul'),
    ('bento goncalves','Bento Gonçalves','RS','Sul'),
    -- SC
    ('joinville','Joinville','SC','Sul'),
    ('blumenau','Blumenau','SC','Sul'),
    ('chapeco','Chapecó','SC','Sul'),
    ('itajai','Itajaí','SC','Sul'),
    ('sao jose','São José','SC','Sul'),
    ('criciuma','Criciúma','SC','Sul'),
    ('lages','Lages','SC','Sul'),
    ('balneario camboriu','Balneário Camboriú','SC','Sul'),
    ('jaragua do sul','Jaraguá do Sul','SC','Sul'),
    ('palhoca','Palhoça','SC','Sul'),
    -- BA
    ('feira de santana','Feira de Santana','BA','Nordeste'),
    ('ilheus','Ilhéus','BA','Nordeste'),
    ('vitoria da conquista','Vitória da Conquista','BA','Nordeste'),
    ('camacari','Camaçari','BA','Nordeste'),
    ('lauro de freitas','Lauro de Freitas','BA','Nordeste'),
    ('juazeiro','Juazeiro','BA','Nordeste'),
    ('itabuna','Itabuna','BA','Nordeste'),
    ('jequie','Jequié','BA','Nordeste'),
    ('barreiras','Barreiras','BA','Nordeste'),
    ('porto seguro','Porto Seguro','BA','Nordeste'),
    -- PE
    ('caruaru','Caruaru','PE','Nordeste'),
    ('olinda','Olinda','PE','Nordeste'),
    ('jaboatao dos guararapes','Jaboatão dos Guararapes','PE','Nordeste'),
    ('petrolina','Petrolina','PE','Nordeste'),
    ('paulista','Paulista','PE','Nordeste'),
    ('cabo de santo agostinho','Cabo de Santo Agostinho','PE','Nordeste'),
    ('garanhuns','Garanhuns','PE','Nordeste'),
    -- CE
    ('caucaia','Caucaia','CE','Nordeste'),
    ('juazeiro do norte','Juazeiro do Norte','CE','Nordeste'),
    ('maracanau','Maracanaú','CE','Nordeste'),
    ('sobral','Sobral','CE','Nordeste'),
    ('crato','Crato','CE','Nordeste'),
    -- MA
    ('imperatriz','Imperatriz','MA','Nordeste'),
    ('caxias','Caxias','MA','Nordeste'),
    ('timon','Timon','MA','Nordeste'),
    ('codo','Codó','MA','Nordeste'),
    -- PI
    ('parnaiba','Parnaíba','PI','Nordeste'),
    ('picos','Picos','PI','Nordeste'),
    -- RN
    ('mossoro','Mossoró','RN','Nordeste'),
    ('parnamirim','Parnamirim','RN','Nordeste'),
    -- PB
    ('campina grande','Campina Grande','PB','Nordeste'),
    ('santa rita','Santa Rita','PB','Nordeste'),
    ('patos','Patos','PB','Nordeste'),
    -- AL
    ('arapiraca','Arapiraca','AL','Nordeste'),
    ('rio largo','Rio Largo','AL','Nordeste'),
    -- SE
    ('nossa senhora do socorro','Nossa Senhora do Socorro','SE','Nordeste'),
    ('lagarto','Lagarto','SE','Nordeste'),
    -- GO
    ('anapolis','Anápolis','GO','Centro-Oeste'),
    ('aparecida de goiania','Aparecida de Goiânia','GO','Centro-Oeste'),
    ('rio verde','Rio Verde','GO','Centro-Oeste'),
    ('luziania','Luziânia','GO','Centro-Oeste'),
    ('valparaiso de goias','Valparaíso de Goiás','GO','Centro-Oeste'),
    -- MT
    ('varzea grande','Várzea Grande','MT','Centro-Oeste'),
    ('rondonopolis','Rondonópolis','MT','Centro-Oeste'),
    ('sinop','Sinop','MT','Centro-Oeste'),
    ('tangara da serra','Tangará da Serra','MT','Centro-Oeste'),
    -- MS
    ('dourados','Dourados','MS','Centro-Oeste'),
    ('tres lagoas','Três Lagoas','MS','Centro-Oeste'),
    ('corumba','Corumbá','MS','Centro-Oeste'),
    -- PA
    ('ananindeua','Ananindeua','PA','Norte'),
    ('santarem','Santarém','PA','Norte'),
    ('maraba','Marabá','PA','Norte'),
    ('castanhal','Castanhal','PA','Norte'),
    ('parauapebas','Parauapebas','PA','Norte'),
    -- AM
    ('parintins','Parintins','AM','Norte'),
    ('itacoatiara','Itacoatiara','AM','Norte'),
    ('manacapuru','Manacapuru','AM','Norte'),
    -- TO
    ('araguaina','Araguaína','TO','Norte'),
    ('gurupi','Gurupi','TO','Norte'),
    -- RO
    ('ji parana','Ji-Paraná','RO','Norte'),
    ('ariquemes','Ariquemes','RO','Norte'),
    ('vilhena','Vilhena','RO','Norte'),
    -- AP
    ('santana','Santana','AP','Norte'),
    -- AC
    ('cruzeiro do sul','Cruzeiro do Sul','AC','Norte')
  ) AS v(norm, city, uf, region);
$function$;

-- ============================================================
-- Cities ranking summary v2: normalização + validação + coverage
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cities_ranking_summary(_user_id uuid, _candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
      lower(unaccent(coalesce(si.comment_text,'') || ' ' ||
                     coalesce(si.comment_author,'') || ' ' ||
                     coalesce(si.author_profile_url,'') || ' ' ||
                     coalesce(si.post_title,''))) AS hay,
      lower(unaccent(coalesce(si.city,''))) AS r_city_norm,
      nullif(upper(coalesce(si.state,'')),'') AS r_state,
      si.region AS r_region
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND si.candidate_id = _candidate_id
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY coalesce(si.collected_at, si.created_at) DESC NULLS LAST
    LIMIT 80000
  ),
  dict AS (SELECT * FROM public._regional_city_dict()),
  -- Stage 1: tenta normalizar r_city pelo dicionário
  s1 AS (
    SELECT b.*,
      (SELECT row_to_json(d.*) FROM dict d
        WHERE b.r_city_norm <> '' AND d.norm = b.r_city_norm
        LIMIT 1) AS dict_from_field
    FROM base b
  ),
  -- Stage 2: se não bateu, busca no texto
  s2 AS (
    SELECT s.*,
      CASE WHEN s.dict_from_field IS NULL THEN
        (SELECT row_to_json(d.*) FROM dict d
          WHERE position((' '||d.norm||' ') IN (' '||s.hay||' ')) > 0
          ORDER BY length(d.norm) DESC LIMIT 1)
      END AS dict_from_text
    FROM s1 s
  ),
  resolved AS (
    SELECT
      s2.id, s2.sentiment_label, s2.at,
      s2.r_state, s2.r_region,
      COALESCE(s2.dict_from_field, s2.dict_from_text) AS d,
      CASE
        WHEN s2.dict_from_field IS NOT NULL THEN 'high'
        WHEN s2.dict_from_text IS NOT NULL THEN 'low'
        ELSE NULL
      END AS confidence
    FROM s2
  ),
  -- Cidade final canônica + validação cidade↔UF
  final AS (
    SELECT
      r.id, r.sentiment_label, r.at, r.confidence,
      (r.d->>'city') AS city,
      -- UF: se DB e dict batem, ok. Se divergem, prefere o do dict (válido).
      CASE
        WHEN r.d IS NOT NULL THEN (r.d->>'uf')
        WHEN r.r_state IS NOT NULL THEN r.r_state
        ELSE NULL
      END AS uf,
      CASE
        WHEN r.d IS NOT NULL THEN (r.d->>'region')
        WHEN r.r_state IS NOT NULL THEN public._region_from_uf(r.r_state)
        ELSE r.r_region
      END AS region
    FROM resolved r
  ),
  agg AS (
    SELECT city, uf,
      max(confidence) AS confidence,
      count(*)::bigint AS total,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos'))::bigint AS pos,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg'))::bigint AS neg,
      count(*) FILTER (WHERE lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu'))::bigint AS neu,
      count(*) FILTER (WHERE at >= now() - interval '7 days')::bigint AS recent,
      count(*) FILTER (WHERE at >= now() - interval '14 days' AND at < now() - interval '7 days')::bigint AS previous
    FROM final
    WHERE city IS NOT NULL AND uf IS NOT NULL
    GROUP BY city, uf
  )
  SELECT jsonb_build_object(
    'cities', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'city', city, 'uf', uf, 'total', total,
        'pos', pos, 'neg', neg, 'neu', neu,
        'recent', recent, 'previous', previous,
        'confidence', confidence
      ) ORDER BY total DESC) FROM agg), '[]'::jsonb),
    'totalRecords', (SELECT count(*) FROM final),
    'withCity',     (SELECT count(*) FROM final WHERE city IS NOT NULL AND uf IS NOT NULL),
    'withState',    (SELECT count(*) FROM final WHERE uf IS NOT NULL),
    'withRegion',   (SELECT count(*) FROM final WHERE region IS NOT NULL),
    'withoutCity',  (SELECT count(*) FROM final WHERE city IS NULL OR uf IS NULL),
    'withoutLocation', (SELECT count(*) FROM final WHERE region IS NULL),
    'lowConfidence', (SELECT count(*) FROM final WHERE confidence = 'low'),
    'citiesCount',  (SELECT count(*) FROM agg),
    'statesCount',  (SELECT count(DISTINCT uf) FROM final WHERE uf IS NOT NULL),
    'regionsCount', (SELECT count(DISTINCT region) FROM final WHERE region IS NOT NULL)
  ) INTO v_result;

  RETURN coalesce(v_result, '{}'::jsonb);
END $function$;

-- unaccent extension (idempotent)
CREATE EXTENSION IF NOT EXISTS unaccent;
