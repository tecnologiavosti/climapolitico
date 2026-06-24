
-- Extensions
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============ TABLE ============
CREATE TABLE IF NOT EXISTS public.politicians (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tse_id TEXT UNIQUE,
  nome TEXT NOT NULL,
  nome_urna TEXT,
  nome_normalizado TEXT,
  cpf_hash TEXT,
  partido_sigla TEXT,
  partido_nome TEXT,
  numero_partido TEXT,
  cargo TEXT,
  regiao TEXT,
  estado TEXT,
  municipio TEXT,
  eleito BOOLEAN NOT NULL DEFAULT false,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ano_eleicao INT,
  foto_url TEXT,
  redes_sociais JSONB DEFAULT '{}'::jsonb,
  popularidade NUMERIC NOT NULL DEFAULT 0,
  search_tsv tsvector,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GRANTS (catalog is public-readable; writes only by service_role/ETL)
GRANT SELECT ON public.politicians TO anon, authenticated;
GRANT ALL ON public.politicians TO service_role;

ALTER TABLE public.politicians ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Politicians are publicly readable" ON public.politicians;
CREATE POLICY "Politicians are publicly readable"
  ON public.politicians FOR SELECT
  USING (true);

-- ============ INDEXES ============
CREATE INDEX IF NOT EXISTS politicians_search_tsv_idx ON public.politicians USING GIN (search_tsv);
CREATE INDEX IF NOT EXISTS politicians_nome_trgm_idx ON public.politicians USING GIN (nome_normalizado gin_trgm_ops);
CREATE INDEX IF NOT EXISTS politicians_cargo_state_party_idx ON public.politicians (cargo, estado, partido_sigla);
CREATE INDEX IF NOT EXISTS politicians_rank_idx ON public.politicians (ativo, eleito, popularidade DESC);
CREATE INDEX IF NOT EXISTS politicians_regiao_idx ON public.politicians (regiao);
CREATE INDEX IF NOT EXISTS politicians_municipio_idx ON public.politicians (municipio);

-- ============ TRIGGER (normalize + tsv) ============
CREATE OR REPLACE FUNCTION public.politicians_refresh_search()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.nome_normalizado := lower(unaccent(coalesce(NEW.nome, '')));
  NEW.search_tsv :=
      setweight(to_tsvector('portuguese', unaccent(coalesce(NEW.nome, ''))), 'A')
    || setweight(to_tsvector('portuguese', unaccent(coalesce(NEW.nome_urna, ''))), 'A')
    || setweight(to_tsvector('portuguese', unaccent(coalesce(NEW.partido_sigla, '') || ' ' || coalesce(NEW.partido_nome, ''))), 'B')
    || setweight(to_tsvector('portuguese', unaccent(coalesce(NEW.cargo, '') || ' ' || coalesce(NEW.estado, '') || ' ' || coalesce(NEW.municipio, ''))), 'C');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS politicians_refresh ON public.politicians;
CREATE TRIGGER politicians_refresh
BEFORE INSERT OR UPDATE ON public.politicians
FOR EACH ROW EXECUTE FUNCTION public.politicians_refresh_search();

-- ============ SEARCH RPC ============
DROP FUNCTION IF EXISTS public.search_politicians(
  text, text[], text[], text[], text[], text, boolean, int, int
);

CREATE OR REPLACE FUNCTION public.search_politicians(
  q TEXT DEFAULT NULL,
  p_cargo TEXT[] DEFAULT NULL,
  p_partido TEXT[] DEFAULT NULL,
  p_regiao TEXT[] DEFAULT NULL,
  p_estado TEXT[] DEFAULT NULL,
  p_municipio TEXT DEFAULT NULL,
  p_only_eleitos BOOLEAN DEFAULT false,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  tse_id TEXT,
  nome TEXT,
  nome_urna TEXT,
  partido_sigla TEXT,
  partido_nome TEXT,
  numero_partido TEXT,
  cargo TEXT,
  regiao TEXT,
  estado TEXT,
  municipio TEXT,
  eleito BOOLEAN,
  ano_eleicao INT,
  foto_url TEXT,
  redes_sociais JSONB,
  popularidade NUMERIC,
  similarity REAL,
  total_count BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  q_norm TEXT := nullif(lower(unaccent(coalesce(q, ''))), '');
  muni_norm TEXT := nullif(lower(unaccent(coalesce(p_municipio, ''))), '');
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT p.*,
      CASE
        WHEN q_norm IS NULL THEN 0::real
        ELSE GREATEST(
          similarity(p.nome_normalizado, q_norm),
          ts_rank(p.search_tsv, plainto_tsquery('portuguese', q_norm))::real
        )
      END AS sim
    FROM public.politicians p
    WHERE p.ativo = true
      AND (NOT p_only_eleitos OR p.eleito = true)
      AND (p_cargo IS NULL OR p.cargo = ANY(p_cargo))
      AND (p_partido IS NULL OR p.partido_sigla = ANY(p_partido))
      AND (p_regiao IS NULL OR p.regiao = ANY(p_regiao))
      AND (p_estado IS NULL OR p.estado = ANY(p_estado))
      AND (muni_norm IS NULL OR lower(unaccent(p.municipio)) LIKE '%' || muni_norm || '%')
      AND (
        q_norm IS NULL
        OR p.search_tsv @@ plainto_tsquery('portuguese', q_norm)
        OR p.nome_normalizado % q_norm
        OR p.nome_normalizado ILIKE '%' || q_norm || '%'
      )
  ),
  counted AS (SELECT count(*)::bigint AS total FROM base)
  SELECT b.id, b.tse_id, b.nome, b.nome_urna, b.partido_sigla, b.partido_nome,
         b.numero_partido, b.cargo, b.regiao, b.estado, b.municipio,
         b.eleito, b.ano_eleicao, b.foto_url, b.redes_sociais, b.popularidade,
         b.sim AS similarity,
         (SELECT total FROM counted) AS total_count
  FROM base b
  ORDER BY
    CASE WHEN q_norm IS NULL THEN 0 ELSE 1 END,
    b.sim DESC,
    b.eleito DESC,
    b.popularidade DESC,
    b.nome ASC
  LIMIT GREATEST(p_limit, 1)
  OFFSET GREATEST(p_offset, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_politicians(text, text[], text[], text[], text[], text, boolean, int, int) TO anon, authenticated;

-- ============ SUGGEST RPC ============
DROP FUNCTION IF EXISTS public.suggest_politicians(text, int);

CREATE OR REPLACE FUNCTION public.suggest_politicians(
  q TEXT,
  p_limit INT DEFAULT 5
)
RETURNS TABLE (id UUID, nome TEXT, partido_sigla TEXT, cargo TEXT, estado TEXT, similarity REAL)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  q_norm TEXT := nullif(lower(unaccent(coalesce(q, ''))), '');
BEGIN
  IF q_norm IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.id, p.nome, p.partido_sigla, p.cargo, p.estado,
         similarity(p.nome_normalizado, q_norm) AS sim
  FROM public.politicians p
  WHERE p.ativo = true
    AND similarity(p.nome_normalizado, q_norm) > 0.2
  ORDER BY sim DESC, p.eleito DESC, p.popularidade DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_politicians(text, int) TO anon, authenticated;
