
-- 1) Expand hashtag blocklist (fyp, viral, aovivo, foryou, fy, explore, presidente as standalone tag, etc.)
CREATE OR REPLACE FUNCTION public.nv_is_valid_hashtag(_tag text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  WITH n AS (SELECT public.nv_normalize_hashtag(_tag) AS tag)
  SELECT tag IS NOT NULL
    AND length(tag) BETWEEN 3 AND 40
    AND tag ~ '[a-z]'
    AND tag !~ '^[0-9_-]+$'
    AND tag !~* '^[0-9a-f]{3}$'
    AND tag !~* '^[0-9a-f]{6}$'
    AND tag !~* '^[0-9a-f]{8}$'
    AND tag !~* '^(x200b|xfeff|nbsp|amp|quot|apos|zwj|zwnj|null|undefined|nan)$'
    AND tag NOT IN (
      'rt','via','http','https','www','com','br','amp','utm','href','src','img','div','span','class','style','color','rgb','rgba','hsl','px','rem','x200b','xfeff','nbsp',
      -- viral/generic blocklist per spec
      'fyp','fy','foryou','foryoupage','viral','viralvideo','aovivo','aoVivo','live','explore','explorepage','tiktok','reels','shorts','trending','trend','parati','paravoce',
      -- ambiguous standalone words (require context, not these alone)
      'presidente','brasil','politica','political','news','noticias','noticia'
    )
    -- entertainment/sports noise as hashtag
    AND tag !~* '(futebol|neymar|bbb|novela|gameplay|memes?|celebridad|entreten|musica|cantor|atriz|ator|gospel|funk|sertanej|kpop)'
  FROM n;
$function$;

-- 2) Stricter political relevance scorer (more weight on political entities, heavier penalty for noise)
CREATE OR REPLACE FUNCTION public.nv_political_relevance_score(_text text, _candidate_name text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  WITH input AS (
    SELECT public.nv_clean_text(coalesce(_text,'')) AS txt,
           public.nv_clean_text(coalesce(_candidate_name,'')) AS cand
  ), terms AS (
    SELECT term
    FROM input, unnest(regexp_split_to_array(cand, '\s+')) AS term
    WHERE length(term) > 2 AND term NOT IN ('dos','das','com','para','por','de','da','do','e')
  ), scored AS (
    SELECT
      (
        CASE WHEN EXISTS (SELECT 1 FROM terms WHERE position(term IN txt) > 0) THEN 0.45 ELSE 0 END +
        CASE WHEN txt ~ '(politic|governo|governador|prefeit|presidente|minister|secretari|eleic|eleiç|voto|urna|campanha|candidat|partido|congresso|camara|câmara|senado|deputad|senador|vereador|stf|supremo|tse|planalto|brasilia|brasília|moraes|barroso|gilmar|fachin|dino|lula|bolsonaro|haddad|tarcisio|zema|boulos|nikolas|janja|alckmin|valdemar|kassab|pacheco|lira)' THEN 0.45 ELSE 0 END +
        CASE WHEN txt ~ '(reforma tribut|imposto|tribut|orcament|orçament|fiscal|selic|juros|inflac|inflaç|pib|desemprego|bolsa familia|bolsa família|auxilio|auxílio|seguranca publica|segurança publica|corrup|propina|lava jato|cpi|cpmi|anistia|8 de janeiro|democracia|ditadura|direitos humanos|reforma|vorcaro|tarifaço|tarifaco|marcha para jesus|banco dos brics)' THEN 0.40 ELSE 0 END +
        CASE WHEN txt ~ '(brics|onu|otan|mercosul|maduro|trump|biden|putin|milei|venezuela|argentina|china|gaza|israel|ucrania|ucrân)' THEN 0.20 ELSE 0 END
      ) AS raw_score,
      (txt ~ '(futebol|neymar|santos fc|palmeiras|corinthians|flamengo|vasco|gremio|grêmio|botafogo|serie a|campeonato|libertadores|celebridade|celebridades|humor|meme|memes|entretenimento|novela|bbb|games|gameplay|musica|música|show|cantor|atriz|ator|esporte|esportes|gospel|funk|sertanej|kpop|tiktoker|youtuber|influencer)') AS non_political_noise
    FROM input
  )
  SELECT CASE
    WHEN raw_score <= 0 THEN 0::numeric
    WHEN non_political_noise AND raw_score < 0.85 THEN 0::numeric
    WHEN non_political_noise THEN least(1::numeric, (raw_score * 0.5)::numeric)
    ELSE least(1::numeric, raw_score::numeric)
  END
  FROM scored;
$function$;

-- 3) Top posts: require political relevance >= 0.45, order by political score × engagement
CREATE OR REPLACE FUNCTION public.network_view_top_posts(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := current_date::timestamptz - (v_days - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_top_v11', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH cands AS MATERIALIZED (
    SELECT si.id, public.nv_network_key(si.social_network) AS social_network, si.comment_text, si.comment_author,
      public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)) AS sent,
      (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0))::bigint AS eng,
      COALESCE(si.likes_count,0)::bigint AS likes, COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      si.original_posted_at, si.collected_at, si.post_url,
      public.nv_political_relevance_score(concat_ws(' ', si.comment_text, si.post_title, si.post_description), c.full_name) AS political_relevance
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE si.original_posted_at >= v_since
      AND si.original_posted_at < v_until
      AND si.invalidated_at IS NULL
      AND si.comment_text IS NOT NULL AND length(si.comment_text) > 0
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
    ORDER BY (COALESCE(si.likes_count,0)+COALESCE(si.replies_count,0)+COALESCE(si.shares_count,0)) DESC NULLS LAST, si.original_posted_at DESC
    LIMIT 2000
  ), political AS (
    SELECT * FROM cands WHERE political_relevance >= 0.45
  ), deduped AS (
    SELECT DISTINCT ON (coalesce(post_url, id::text)) * FROM political ORDER BY coalesce(post_url, id::text), eng DESC, original_posted_at DESC
  ), ranked AS (
    SELECT *, (eng::numeric * political_relevance) AS score
    FROM deduped
    ORDER BY (eng::numeric * political_relevance) DESC, original_posted_at DESC
    LIMIT 5
  )
  SELECT jsonb_build_object('top_posts', coalesce(jsonb_agg(to_jsonb(ranked.*) ORDER BY score DESC, original_posted_at DESC),'[]'::jsonb))
  INTO v_data FROM ranked;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'top_posts',v_data,0,v_duration,'{"source":"published_window_political_score_v11"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar os top posts.');
END; $function$;

-- 4) Content metrics: stricter non-political theme filter
CREATE OR REPLACE FUNCTION public.network_view_content_metrics(p_candidate_id uuid DEFAULT NULL::uuid, p_network text DEFAULT NULL::text, p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since date := (current_date - v_days + 1);
  v_prev_since date := (current_date - (v_days * 2) + 1);
  v_started timestamptz := clock_timestamp();
  v_cache_key text; v_cached jsonb; v_data jsonb; v_duration int := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'message','Sessão expirada.'); END IF;
  v_cache_key := md5(concat_ws('|','nv_content_v11', v_uid::text, coalesce(p_candidate_id::text,'all'), coalesce(v_network,'all'), v_days::text));
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key AND expires_at > now();
  IF v_cached IS NOT NULL THEN
    UPDATE public.network_view_cache SET hit_count=hit_count+1,last_hit_at=now() WHERE cache_key=v_cache_key;
    RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true));
  END IF;

  WITH t_cur AS (
    SELECT theme, sum(mentions)::bigint AS mentions,
      sum(positive_count)::bigint AS pos, sum(negative_count)::bigint AS neg, sum(neutral_count)::bigint AS neu
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND theme !~* '(geral|outros|misc|diversos|sem tema|futebol|esporte|celebridad|entreten|novela|bbb|música|musica|meme|gameplay|games|gospel|funk|sertanej|kpop|tiktok|reels|viral|influencer|youtuber)'
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), t_prev AS (
    SELECT theme, sum(mentions)::bigint AS prev_mentions
    FROM public.daily_topic_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND theme !~* '(geral|outros|misc|diversos|sem tema|futebol|esporte|celebridad|entreten|novela|bbb|música|musica|meme|gameplay|games|gospel|funk|sertanej|kpop|tiktok|reels|viral|influencer|youtuber)'
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), topics AS (
    SELECT c.theme, c.mentions, c.pos, c.neg, c.neu, coalesce(p.prev_mentions,0)::bigint AS prev_mentions
    FROM t_cur c LEFT JOIN t_prev p USING (theme) WHERE c.mentions > 0 ORDER BY mentions DESC LIMIT 15
  ), h_cur AS (
    SELECT public.nv_hashtag_display(tag) AS tag, sum(mentions)::bigint AS c,
      sum(positive_count)::bigint AS pos, sum(negative_count)::bigint AS neg, sum(neutral_count)::bigint AS neu
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_since AND metric_date <= current_date
      AND public.nv_is_valid_hashtag(replace(tag,'#',''))
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), h_prev AS (
    SELECT public.nv_hashtag_display(tag) AS tag, sum(mentions)::bigint AS prev_c
    FROM public.daily_hashtag_metrics
    WHERE metric_date >= v_prev_since AND metric_date < v_since
      AND public.nv_is_valid_hashtag(replace(tag,'#',''))
      AND (v_is_admin OR user_id = v_uid)
      AND (p_candidate_id IS NULL OR candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(network) = v_network)
    GROUP BY 1
  ), hashtags AS (
    SELECT c.tag, c.c, c.pos, c.neg, c.neu, coalesce(p.prev_c,0)::bigint AS prev_c
    FROM h_cur c LEFT JOIN h_prev p USING (tag)
    WHERE c.tag IS NOT NULL AND public.nv_is_valid_hashtag(replace(c.tag,'#',''))
    ORDER BY c.c DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'topics',(SELECT coalesce(jsonb_agg(to_jsonb(topics.*) ORDER BY mentions DESC),'[]'::jsonb) FROM topics),
    'hashtags',(SELECT coalesce(jsonb_agg(to_jsonb(hashtags.*) ORDER BY c DESC),'[]'::jsonb) FROM hashtags)
  ) INTO v_data;

  v_duration := floor(extract(epoch FROM (clock_timestamp()-v_started))*1000)::int;
  INSERT INTO public.network_view_cache (cache_key,user_id,candidate_id,network,days,section,result,source_rows,duration_ms,plan,expires_at)
  VALUES (v_cache_key,v_uid,p_candidate_id,v_network,v_days,'content',v_data,0,v_duration,'{"source":"daily_political_aggregates_v11"}'::jsonb, now()+interval '15 minutes')
  ON CONFLICT (cache_key) DO UPDATE SET result=EXCLUDED.result,duration_ms=EXCLUDED.duration_ms,expires_at=EXCLUDED.expires_at,updated_at=now();
  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('cache_hit',false,'duration_ms',v_duration));
EXCEPTION WHEN OTHERS THEN
  SELECT result INTO v_cached FROM public.network_view_cache WHERE cache_key = v_cache_key ORDER BY updated_at DESC LIMIT 1;
  IF v_cached IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'data',v_cached,'diagnostics',jsonb_build_object('cache_hit',true,'stale',true)); END IF;
  RETURN jsonb_build_object('ok',false,'message','Não foi possível carregar assuntos e hashtags.');
END; $function$;

-- 5) Invalidate stale caches so new filters take effect immediately
DELETE FROM public.network_view_cache WHERE section IN ('top_posts','content');
