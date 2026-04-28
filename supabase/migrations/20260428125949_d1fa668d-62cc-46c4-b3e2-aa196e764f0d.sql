-- Heuristic regional classification done in pure SQL (very fast).
-- We update social_interactions.region in one pass for rows where region IS NULL.

-- Helper: build the search blob once via UPDATE
DO $$
BEGIN
  -- 1) UF code (e.g. "- SP", "/RJ")
  UPDATE public.social_interactions SET region = 'Sudeste'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'') || ' ' || COALESCE(author_profile_url,'')
         ~ '[\s/\-,](SP|RJ|MG|ES)\b';

  UPDATE public.social_interactions SET region = 'Sul'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'') || ' ' || COALESCE(author_profile_url,'')
         ~ '[\s/\-,](RS|SC|PR)\b';

  UPDATE public.social_interactions SET region = 'Nordeste'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'') || ' ' || COALESCE(author_profile_url,'')
         ~ '[\s/\-,](BA|PE|CE|MA|PB|RN|AL|SE|PI)\b';

  UPDATE public.social_interactions SET region = 'Centro-Oeste'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'') || ' ' || COALESCE(author_profile_url,'')
         ~ '[\s/\-,](DF|GO|MT|MS)\b';

  UPDATE public.social_interactions SET region = 'Norte'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'') || ' ' || COALESCE(author_profile_url,'')
         ~ '[\s/\-,](AM|PA|AC|RO|RR|AP|TO)\b';

  -- 2) Cities (case-insensitive)
  UPDATE public.social_interactions SET region = 'Nordeste'
   WHERE region IS NULL
     AND (COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'')) ~* '\m(salvador|recife|fortaleza|s[aã]o lu[ií]s|natal|macei[oó]|jo[aã]o pessoa|aracaju|teresina|olinda|caruaru|petrolina|feira de santana)\M';

  UPDATE public.social_interactions SET region = 'Sudeste'
   WHERE region IS NULL
     AND (COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'')) ~* '\m(s[aã]o paulo|rio de janeiro|belo horizonte|vit[oó]ria|campinas|niter[oó]i|santos|guarulhos|osasco|uberl[aâ]ndia|juiz de fora|sorocaba)\M';

  UPDATE public.social_interactions SET region = 'Sul'
   WHERE region IS NULL
     AND (COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'')) ~* '\m(porto alegre|curitiba|florian[oó]polis|caxias do sul|londrina|joinville|maring[aá]|blumenau|chapec[oó]|pelotas)\M';

  UPDATE public.social_interactions SET region = 'Centro-Oeste'
   WHERE region IS NULL
     AND (COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'')) ~* '\m(goi[aâ]nia|bras[ií]lia|cuiab[aá]|campo grande|an[aá]polis|rondon[oó]polis)\M';

  UPDATE public.social_interactions SET region = 'Norte'
   WHERE region IS NULL
     AND (COALESCE(comment_text,'') || ' ' || COALESCE(comment_author,'')) ~* '\m(manaus|bel[eé]m|porto velho|rio branco|boa vista|macap[aá]|palmas)\M';

  -- 3) Slangs / cultural
  UPDATE public.social_interactions SET region = 'Nordeste'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') ~* '\m(oxe|vixe|arr[ae]ta|forr[oó]|ax[eé]|lampi[aã]o|cabra da peste|ar[ei]gua)\M';

  UPDATE public.social_interactions SET region = 'Sul'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') ~* '\m(tch[eê]|bah|guri|piá|chimarr[aã]o|barbaridade)\M';

  UPDATE public.social_interactions SET region = 'Sudeste'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') ~* '\m(uai|trem bom)\M';

  UPDATE public.social_interactions SET region = 'Norte'
   WHERE region IS NULL
     AND COALESCE(comment_text,'') ~* '\m(égua|p[aá]i d[''é]g[uú]a|maninho)\M';
END $$;