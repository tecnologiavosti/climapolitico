
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE public.public_candidates_catalog
  ADD COLUMN IF NOT EXISTS "position" text,
  ADD COLUMN IF NOT EXISTS party_number text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS macro_region text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS monitorable_networks text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS popularity_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS name_normalized text,
  ADD COLUMN IF NOT EXISTS search_tsv tsvector;

CREATE OR REPLACE FUNCTION public.uf_to_macro_region(uf text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE upper(coalesce(uf,''))
    WHEN 'AC' THEN 'norte' WHEN 'AP' THEN 'norte' WHEN 'AM' THEN 'norte'
    WHEN 'PA' THEN 'norte' WHEN 'RO' THEN 'norte' WHEN 'RR' THEN 'norte' WHEN 'TO' THEN 'norte'
    WHEN 'AL' THEN 'nordeste' WHEN 'BA' THEN 'nordeste' WHEN 'CE' THEN 'nordeste'
    WHEN 'MA' THEN 'nordeste' WHEN 'PB' THEN 'nordeste' WHEN 'PE' THEN 'nordeste'
    WHEN 'PI' THEN 'nordeste' WHEN 'RN' THEN 'nordeste' WHEN 'SE' THEN 'nordeste'
    WHEN 'DF' THEN 'centro-oeste' WHEN 'GO' THEN 'centro-oeste'
    WHEN 'MT' THEN 'centro-oeste' WHEN 'MS' THEN 'centro-oeste'
    WHEN 'ES' THEN 'sudeste' WHEN 'MG' THEN 'sudeste' WHEN 'RJ' THEN 'sudeste' WHEN 'SP' THEN 'sudeste'
    WHEN 'PR' THEN 'sul' WHEN 'RS' THEN 'sul' WHEN 'SC' THEN 'sul'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.public_candidates_catalog_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.name_normalized := lower(public.unaccent(coalesce(NEW.full_name,'')));
  IF NEW.state IS NOT NULL AND NEW.macro_region IS NULL THEN
    NEW.macro_region := public.uf_to_macro_region(NEW.state);
  END IF;
  NEW.search_tsv :=
    setweight(to_tsvector('simple', public.unaccent(coalesce(NEW.full_name,''))), 'A') ||
    setweight(to_tsvector('simple', public.unaccent(coalesce(NEW.party,'') || ' ' || coalesce(NEW.party_number,''))), 'B') ||
    setweight(to_tsvector('simple', public.unaccent(coalesce(NEW."position",'') || ' ' || coalesce(NEW.category,''))), 'B') ||
    setweight(to_tsvector('simple', public.unaccent(coalesce(NEW.state,'') || ' ' || coalesce(NEW.city,'') || ' ' || coalesce(NEW.region,''))), 'C') ||
    setweight(to_tsvector('simple', public.unaccent(coalesce(NEW.description,''))), 'D');
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_public_candidates_catalog_refresh ON public.public_candidates_catalog;
CREATE TRIGGER trg_public_candidates_catalog_refresh
BEFORE INSERT OR UPDATE ON public.public_candidates_catalog
FOR EACH ROW EXECUTE FUNCTION public.public_candidates_catalog_refresh();

UPDATE public.public_candidates_catalog SET full_name = full_name;

CREATE INDEX IF NOT EXISTS idx_pcc_search_tsv ON public.public_candidates_catalog USING gin (search_tsv);
CREATE INDEX IF NOT EXISTS idx_pcc_name_trgm ON public.public_candidates_catalog USING gin (name_normalized gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_pcc_position ON public.public_candidates_catalog ("position");
CREATE INDEX IF NOT EXISTS idx_pcc_state ON public.public_candidates_catalog (state);
CREATE INDEX IF NOT EXISTS idx_pcc_party ON public.public_candidates_catalog (party);
CREATE INDEX IF NOT EXISTS idx_pcc_popularity ON public.public_candidates_catalog (popularity_score DESC);
CREATE INDEX IF NOT EXISTS idx_pcc_state_position ON public.public_candidates_catalog (state, "position");

CREATE OR REPLACE FUNCTION public.search_catalog(
  q text DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_party text DEFAULT NULL,
  p_state text DEFAULT NULL,
  p_city text DEFAULT NULL,
  p_region text DEFAULT NULL,
  p_order text DEFAULT 'relevance',
  p_limit int DEFAULT 24,
  p_offset int DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  full_name text,
  party text,
  party_number text,
  cargo text,
  state text,
  city text,
  macro_region text,
  region text,
  photo_url text,
  monitorable_networks text[],
  social_links jsonb,
  social_media_link text,
  description text,
  popularity_score numeric,
  total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q_norm AS (
    SELECT NULLIF(lower(public.unaccent(coalesce(q,''))), '') AS nq
  ),
  base AS (
    SELECT c.*,
      CASE WHEN (SELECT nq FROM q_norm) IS NULL THEN 0
           ELSE GREATEST(
             similarity(c.name_normalized, (SELECT nq FROM q_norm)),
             CASE WHEN c.search_tsv @@ plainto_tsquery('simple', (SELECT nq FROM q_norm)) THEN 0.6 ELSE 0 END
           )
      END AS score
    FROM public.public_candidates_catalog c
    WHERE c.is_active = true
      AND (p_position IS NULL OR c."position" = p_position)
      AND (p_party    IS NULL OR c.party ILIKE p_party)
      AND (p_state    IS NULL OR upper(c.state) = upper(p_state))
      AND (p_city     IS NULL OR lower(public.unaccent(c.city)) = lower(public.unaccent(p_city)))
      AND (p_region   IS NULL OR c.macro_region = p_region)
      AND (
        (SELECT nq FROM q_norm) IS NULL
        OR c.name_normalized ILIKE '%' || (SELECT nq FROM q_norm) || '%'
        OR c.name_normalized % (SELECT nq FROM q_norm)
        OR c.search_tsv @@ plainto_tsquery('simple', (SELECT nq FROM q_norm))
      )
  ),
  counted AS (SELECT count(*) AS total FROM base)
  SELECT b.id, b.full_name, b.party, b.party_number, b."position" AS cargo,
         b.state, b.city, b.macro_region, b.region, b.photo_url,
         b.monitorable_networks, b.social_links, b.social_media_link,
         b.description, b.popularity_score,
         (SELECT total FROM counted) AS total_count
  FROM base b
  ORDER BY
    CASE WHEN p_order = 'name' THEN b.full_name END ASC,
    CASE WHEN p_order = 'popularity' THEN b.popularity_score END DESC,
    CASE WHEN p_order = 'relevance' THEN b.score END DESC,
    b.popularity_score DESC,
    b.full_name ASC
  LIMIT GREATEST(p_limit,1) OFFSET GREATEST(p_offset,0);
$$;

GRANT EXECUTE ON FUNCTION public.search_catalog(text,text,text,text,text,text,text,int,int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.uf_to_macro_region(text) TO anon, authenticated, service_role;
