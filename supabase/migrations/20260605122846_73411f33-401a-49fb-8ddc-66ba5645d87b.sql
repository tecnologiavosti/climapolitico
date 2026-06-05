CREATE OR REPLACE FUNCTION public.social_interaction_political_score(
  _candidate_id uuid,
  _text text,
  _author text DEFAULT NULL::text,
  _network text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  hay text := public.norm_text(coalesce(_text, '') || ' ' || coalesce(_author, '') || ' ' || coalesce(_network, ''));
  author_norm text := public.norm_text(coalesce(_author, ''));
  cand_name text;
  cand_norm text;
  cand_tokens text[];
  token text;
  token_hits integer := 0;
  political_hits integer := 0;
  invalid_hits integer := 0;
  score numeric := 0;
  reason text := '';
  political_terms text[] := ARRAY[
    'politica','politico','politicos','eleicao','eleicoes','eleitoral','campanha','candidato','candidata','candidatura','presidente','presidencia','governador','governadora','senador','senadora','deputado','deputada','prefeito','prefeita','vereador','vereadora','ministro','ministra','governo','planalto','congresso','senado','camara','assembleia','stf','tse','tcu','pgr','agu','tribunal','supremo','partido','coligacao','federacao','mandato','posse','debate','sabatina','entrevista politica','pronunciamento','coletiva','agenda publica','comicio','votacao','plenario','comissao','cpi','projeto de lei','pec','medida provisoria','reforma tributaria','orcamento','imposto','seguranca publica','saude publica','educacao publica','prefeitura','governo federal','governo estadual','pt','pl','mdb','psdb','psd','psol','pdt','psb','pp','republicanos','uniao brasil','novo','podemos','lula','bolsonaro','tarcisio','zema','caiado','haddad','dilma','rousseff','alckmin','moraes','barroso','dino','lira','pacheco','alcolumbre','nikolas','boulos','marcal','flavio bolsonaro'
  ];
  invalid_terms text[] := ARRAY[
    'danilo gentili','the noite','tve bahia','turma da monica','mauricio de sousa','mauricio de souza','the movie','official mv','official music','music video','clipe oficial','videoclipe','lyrics','karaoke','gmm grammy','white music','novela','bbb','big brother','reality','fazenda','masterchef','carnaval','samba','funk','sertanejo','futebol','flamengo','corinthians','palmeiras','vasco','santos fc','sao paulo fc','gremio','cruzeiro','botafogo','neymar','cristiano ronaldo','messi','mbappe','vini jr','ufc','mma','formula 1','nba','netflix','disney','prime video','hbo','spotify','trailer','teaser','filme','serie','temporada','episodio','gameplay','minecraft','free fire','fortnite','receita','culinaria','restaurante','humor','stand up','comediante','variedades','fofoca','celebridade','shorts funny','part2 #shorts','short videos','musica','bateria'
  ];
BEGIN
  SELECT full_name INTO cand_name FROM public.candidates WHERE id = _candidate_id;
  cand_norm := public.norm_text(cand_name);

  FOREACH token IN ARRAY invalid_terms LOOP
    IF hay LIKE '%' || token || '%' THEN invalid_hits := invalid_hits + 1; END IF;
  END LOOP;

  FOREACH token IN ARRAY political_terms LOOP
    IF hay ~ ('(^|[^a-z0-9])' || replace(token, ' ', '[[:space:]]+') || '([^a-z0-9]|$)') THEN political_hits := political_hits + 1; END IF;
  END LOOP;

  IF cand_norm IS NOT NULL AND length(cand_norm) > 0 THEN
    IF hay LIKE '%' || cand_norm || '%' THEN
      score := score + 5; reason := reason || 'nome completo do candidato; ';
    ELSE
      cand_tokens := regexp_split_to_array(cand_norm, '\s+');
      FOREACH token IN ARRAY cand_tokens LOOP
        IF length(token) >= 4 AND token NOT IN ('de','da','do','dos','das','e') AND hay ~ ('(^|[^a-z0-9])' || token || '([^a-z0-9]|$)') THEN token_hits := token_hits + 1; END IF;
      END LOOP;
      IF array_length(cand_tokens, 1) >= 2 AND token_hits >= 2 THEN score := score + 4; reason := reason || 'nome composto do candidato; ';
      ELSIF token_hits >= 1 AND political_hits >= 1 THEN score := score + 2; reason := reason || 'menção parcial com contexto político; '; END IF;
    END IF;
  END IF;

  IF political_hits > 0 THEN score := score + least(political_hits, 4); reason := reason || political_hits || ' termos políticos; '; END IF;
  IF author_norm ~ '(^|[^a-z0-9])(senado|camara|congresso|tse|stf|gov|governo|planalto|partido|pt|pl|mdb|psdb|psol|pdt|psb|republicanos)([^a-z0-9]|$)' THEN score := score + 1; reason := reason || 'origem institucional política; '; END IF;
  IF invalid_hits > 0 THEN score := score - (invalid_hits * 5); reason := reason || invalid_hits || ' sinais não políticos; '; END IF;
  IF length(trim(coalesce(_text, ''))) < 8 THEN score := score - 2; reason := reason || 'texto insuficiente; '; END IF;

  RETURN jsonb_build_object('score', greatest(0, score), 'is_political', (greatest(0, score) >= 3 AND political_hits >= 1 AND invalid_hits = 0), 'reason', nullif(trim(reason), ''));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_reactions_top_posts(
  _user_id uuid,
  _candidate_id uuid DEFAULT NULL::uuid,
  _period_start timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _period_end timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _limit integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  WITH candidates AS (
    SELECT si.*,
      coalesce(si.post_url, CASE WHEN si.author_profile_url ~ '^https?://' THEN si.author_profile_url ELSE NULL END) AS final_post_url,
      coalesce(nullif(si.post_title,''), nullif(split_part(si.comment_text, E'\n', 1), '')) AS final_post_title,
      coalesce(nullif(si.post_description,''), nullif(si.comment_text,'')) AS final_post_description,
      coalesce(nullif(si.author_name,''), nullif(si.comment_author,'')) AS final_author_name,
      (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint AS engagement,
      public.social_interaction_political_score(si.candidate_id, concat_ws(' ', si.post_title, si.post_description, si.comment_text, si.comment_author, si.author_name, si.author_handle, si.author_profile_url), concat_ws(' ', si.comment_author, si.author_name, si.author_handle), si.social_network) AS live_verdict
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.is_political_content = true
      AND si.invalidated_at IS NULL
      AND si.political_relevance_score >= 3
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
      AND public.norm_text(concat_ws(' ', si.post_title, si.post_description, si.comment_text, si.comment_author, si.author_name, si.author_handle, si.author_profile_url)) NOT LIKE ALL (ARRAY['%danilo gentili%','%the noite%','%tve bahia%','%turma da monica%','%mauricio de sousa%','%mauricio de souza%','%the movie%','%official mv%','%music video%','%musica%','%bateria%','%filme%','%novela%','%humor%','%variedades%'])
    ORDER BY engagement DESC NULLS LAST
    LIMIT 200
  ), ranked AS (
    SELECT * FROM candidates WHERE coalesce((live_verdict->>'is_political')::boolean, false) = true ORDER BY engagement DESC NULLS LAST LIMIT greatest(1, least(coalesce(_limit,5), 20))
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'social_network', CASE WHEN lower(coalesce(social_network,'')) IN ('youtube','yt') THEN 'YouTube' WHEN lower(coalesce(social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok' WHEN lower(coalesce(social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter' WHEN lower(coalesce(social_network,'')) IN ('facebook','fb') THEN 'Facebook' WHEN lower(coalesce(social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News' ELSE initcap(replace(coalesce(nullif(social_network,''),'outro'),'_',' ')) END,
    'social_network_raw', lower(coalesce(social_network,'')), 'likes_count', coalesce(likes_count,0), 'replies_count', coalesce(replies_count,0), 'shares_count', coalesce(shares_count,0),
    'sentiment_label', CASE WHEN lower(coalesce(sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo' WHEN lower(coalesce(sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo' WHEN lower(coalesce(sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro' ELSE NULL END,
    'collected_at', coalesce(collected_at, created_at), 'engagement', engagement, 'post_url', final_post_url, 'post_title', final_post_title, 'post_description', final_post_description,
    'thumbnail_url', thumbnail_url, 'author_name', final_author_name, 'author_handle', author_handle, 'author_profile_url', author_profile_url, 'post_id', post_id,
    'political_relevance_score', coalesce((live_verdict->>'score')::numeric, political_relevance_score), 'political_validation_reason', coalesce(live_verdict->>'reason', political_validation_reason)
  ) ORDER BY engagement DESC), '[]'::jsonb) INTO v_result FROM ranked;

  RETURN coalesce(v_result,'[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;