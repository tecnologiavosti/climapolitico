ALTER TABLE public.trending_candidates_cache DROP CONSTRAINT IF EXISTS trending_candidates_cache_pkey;
ALTER TABLE public.trending_candidates_cache ADD COLUMN IF NOT EXISTS rank smallint NOT NULL DEFAULT 1;
ALTER TABLE public.trending_candidates_cache ADD COLUMN IF NOT EXISTS search_score integer NOT NULL DEFAULT 0;
ALTER TABLE public.trending_candidates_cache ADD CONSTRAINT trending_candidates_cache_pkey PRIMARY KEY (role, rank);
DELETE FROM public.trending_candidates_cache;