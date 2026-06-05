ALTER TABLE public.social_interactions
  ADD COLUMN IF NOT EXISTS is_political_content boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS political_relevance_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS political_validation_reason text,
  ADD COLUMN IF NOT EXISTS invalidated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS invalidation_reason text;

CREATE INDEX IF NOT EXISTS idx_social_interactions_political_rank
  ON public.social_interactions (user_id, candidate_id, is_political_content, collected_at DESC)
  WHERE is_political_content = true;

CREATE OR REPLACE FUNCTION public.norm_text(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT lower(translate(coalesce(_value, ''),
    'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'));
$function$;

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
    'politica','politico','politicos','eleicao','eleicoes','eleitoral','campanha','candidato','candidata','candidatura',
    'presidente','presidencia','governador','governadora','senador','senadora','deputado','deputada','prefeito','prefeita','vereador','vereadora','ministro','ministra','governo','planalto','congresso','senado','camara','assembleia','stf','tse','tcu','pgr','agu','tribunal','supremo','partido','coligacao','federacao','mandato','posse','debate','sabatina','entrevista politica','pronunciamento','coletiva','agenda publica','comicio','votacao','plenario','comissao','cpi','projeto de lei','pec','medida provisoria','reforma tributaria','orcamento','imposto','seguranca publica','saude publica','educacao publica','prefeitura','governo federal','governo estadual',
    'pt','pl','mdb','psdb','psd','psol','pdt','psb','pp','republicanos','uniao brasil','novo','podemos','cidadania','avante','solidariedade','pcdob','pv','rede',
    'lula','bolsonaro','tarcisio','zema','caiado','haddad','dilma','rousseff','alckmin','moraes','barroso','dino','lira','pacheco','alcolumbre','nikolas','boulos','marcal'
  ];
  invalid_terms text[] := ARRAY[
    'danilo gentili','the noite','tve bahia','turma da monica','monica','official mv','official music','music video','clipe oficial','videoclipe','lyrics','karaoke','gmm grammy','white music','novela','bbb','big brother','reality','fazenda','masterchef','carnaval','samba','funk','sertanejo','futebol','flamengo','corinthians','palmeiras','vasco','santos fc','sao paulo fc','gremio','cruzeiro','botafogo','neymar','cristiano ronaldo','messi','mbappe','vini jr','ufc','mma','formula 1','nba','netflix','disney','prime video','hbo','spotify','trailer','teaser','filme','serie','temporada','episodio','gameplay','minecraft','free fire','fortnite','receita','culinaria','restaurante','humor','stand up','comediante','variedades','fofoca','celebridade','shorts funny','part2 #shorts','short videos'
  ];
BEGIN
  SELECT full_name INTO cand_name FROM public.candidates WHERE id = _candidate_id;
  cand_norm := public.norm_text(cand_name);

  FOREACH token IN ARRAY invalid_terms LOOP
    IF hay LIKE '%' || token || '%' THEN
      invalid_hits := invalid_hits + 1;
    END IF;
  END LOOP;

  FOREACH token IN ARRAY political_terms LOOP
    IF hay ~ ('(^|[^a-z0-9])' || replace(token, ' ', '[[:space:]]+') || '([^a-z0-9]|$)') THEN
      political_hits := political_hits + 1;
    END IF;
  END LOOP;

  IF cand_norm IS NOT NULL AND length(cand_norm) > 0 THEN
    IF hay LIKE '%' || cand_norm || '%' THEN
      score := score + 5;
      reason := reason || 'nome completo do candidato; ';
    ELSE
      cand_tokens := regexp_split_to_array(cand_norm, '\s+');
      FOREACH token IN ARRAY cand_tokens LOOP
        IF length(token) >= 4 AND token NOT IN ('de','da','do','dos','das','e') AND hay ~ ('(^|[^a-z0-9])' || token || '([^a-z0-9]|$)') THEN
          token_hits := token_hits + 1;
        END IF;
      END LOOP;
      IF array_length(cand_tokens, 1) >= 2 AND token_hits >= 2 THEN
        score := score + 4;
        reason := reason || 'nome composto do candidato; ';
      ELSIF token_hits >= 1 AND political_hits >= 1 THEN
        score := score + 2;
        reason := reason || 'menção parcial com contexto político; ';
      END IF;
    END IF;
  END IF;

  IF political_hits > 0 THEN
    score := score + least(political_hits, 4);
    reason := reason || political_hits || ' termos políticos; ';
  END IF;

  IF author_norm ~ '(^|[^a-z0-9])(senado|camara|congresso|tse|stf|gov|governo|planalto|partido|pt|pl|mdb|psdb|psol|pdt|psb|republicanos)([^a-z0-9]|$)' THEN
    score := score + 1;
    reason := reason || 'origem institucional política; ';
  END IF;

  IF invalid_hits > 0 THEN
    score := score - (invalid_hits * 5);
    reason := reason || invalid_hits || ' sinais não políticos; ';
  END IF;

  IF length(trim(coalesce(_text, ''))) < 8 THEN
    score := score - 2;
    reason := reason || 'texto insuficiente; ';
  END IF;

  RETURN jsonb_build_object(
    'score', greatest(0, score),
    'is_political', (score >= 3 AND invalid_hits = 0) OR (score >= 6 AND political_hits >= 1),
    'reason', nullif(trim(reason), '')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_social_interaction_political_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  verdict jsonb;
  validation_text text;
BEGIN
  validation_text := concat_ws(' ', NEW.post_title, NEW.post_description, NEW.comment_text, NEW.comment_author, NEW.author_name, NEW.author_handle, NEW.author_profile_url);
  verdict := public.social_interaction_political_score(NEW.candidate_id, validation_text, concat_ws(' ', NEW.comment_author, NEW.author_name, NEW.author_handle), NEW.social_network);
  NEW.political_relevance_score := coalesce((verdict->>'score')::numeric, 0);
  NEW.is_political_content := coalesce((verdict->>'is_political')::boolean, false);
  NEW.political_validation_reason := verdict->>'reason';
  IF NEW.is_political_content THEN
    NEW.invalidated_at := NULL;
    NEW.invalidation_reason := NULL;
  ELSE
    NEW.invalidated_at := coalesce(NEW.invalidated_at, now());
    NEW.invalidation_reason := coalesce(NULLIF(NEW.invalidation_reason, ''), 'Conteúdo sem relevância política suficiente para ranking');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_social_interactions_political_validation ON public.social_interactions;
CREATE TRIGGER trg_social_interactions_political_validation
  BEFORE INSERT OR UPDATE OF comment_text, comment_author, author_name, author_handle, author_profile_url, social_network, post_title, post_description, candidate_id
  ON public.social_interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_social_interaction_political_validation();

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
  IF _user_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'social_network', social_network,
    'social_network_raw', social_network_raw,
    'likes_count', likes_count,
    'replies_count', replies_count,
    'shares_count', shares_count,
    'sentiment_label', sentiment_label,
    'collected_at', collected_at,
    'engagement', engagement,
    'post_url', post_url,
    'post_title', post_title,
    'post_description', post_description,
    'thumbnail_url', thumbnail_url,
    'author_name', author_name,
    'author_handle', author_handle,
    'author_profile_url', author_profile_url,
    'post_id', post_id,
    'political_relevance_score', political_relevance_score,
    'political_validation_reason', political_validation_reason
  ) ORDER BY political_relevance_score DESC, engagement DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      si.id,
      CASE
        WHEN lower(coalesce(si.social_network,'')) IN ('youtube','yt') THEN 'YouTube'
        WHEN lower(coalesce(si.social_network,'')) IN ('tiktok','tik tok') THEN 'TikTok'
        WHEN lower(coalesce(si.social_network,'')) IN ('twitter','twitter/x','x','twitter_x') THEN 'Twitter'
        WHEN lower(coalesce(si.social_network,'')) IN ('facebook','fb') THEN 'Facebook'
        WHEN lower(coalesce(si.social_network,'')) IN ('google news','google_news','googlenews','news') THEN 'Google News'
        ELSE initcap(replace(coalesce(nullif(si.social_network,''),'outro'),'_',' '))
      END AS social_network,
      lower(coalesce(si.social_network,'')) AS social_network_raw,
      coalesce(si.likes_count,0) AS likes_count,
      coalesce(si.replies_count,0) AS replies_count,
      coalesce(si.shares_count,0) AS shares_count,
      CASE
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('positivo','positive','pos') THEN 'Positivo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('negativo','negative','neg') THEN 'Negativo'
        WHEN lower(coalesce(si.sentiment_label,'')) IN ('neutro','neutral','neu') THEN 'Neutro'
        ELSE NULL
      END AS sentiment_label,
      coalesce(si.collected_at, si.created_at) AS collected_at,
      (coalesce(si.likes_count,0) + coalesce(si.replies_count,0) + coalesce(si.shares_count,0))::bigint AS engagement,
      coalesce(si.post_url, CASE WHEN si.author_profile_url ~ '^https?://' THEN si.author_profile_url ELSE NULL END) AS post_url,
      coalesce(nullif(si.post_title,''), nullif(split_part(si.comment_text, E'\n', 1), '')) AS post_title,
      coalesce(nullif(si.post_description,''), nullif(si.comment_text,'')) AS post_description,
      si.thumbnail_url,
      coalesce(nullif(si.author_name,''), nullif(si.comment_author,'')) AS author_name,
      si.author_handle,
      si.author_profile_url,
      si.post_id,
      si.political_relevance_score,
      si.political_validation_reason
    FROM public.social_interactions si
    WHERE (v_is_admin OR si.user_id = _user_id)
      AND (_candidate_id IS NULL OR si.candidate_id = _candidate_id)
      AND (_period_start IS NULL OR coalesce(si.collected_at, si.created_at) >= _period_start)
      AND (_period_end IS NULL OR coalesce(si.collected_at, si.created_at) <= _period_end)
      AND si.is_political_content = true
      AND si.invalidated_at IS NULL
      AND si.political_relevance_score >= 3
      AND lower(coalesce(si.social_network,'')) NOT IN ('mastodon','lemmy','pinterest')
    ORDER BY si.political_relevance_score DESC, engagement DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(_limit,5), 20))
  ) t;

  RETURN coalesce(v_result,'[]'::jsonb);
END $function$;

GRANT EXECUTE ON FUNCTION public.norm_text(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_interaction_political_score(uuid,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_reactions_top_posts(uuid,uuid,timestamptz,timestamptz,int) TO authenticated, service_role;