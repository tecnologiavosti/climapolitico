CREATE OR REPLACE FUNCTION public.network_view_core_metrics_v12_impl(
  p_candidate_id uuid DEFAULT NULL,
  p_network text DEFAULT NULL,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := public.has_role(auth.uid(),'admin'::app_role);
  v_days int := greatest(1, least(coalesce(p_days,30), 3650));
  v_network text := CASE WHEN nullif(nullif(p_network,'all'),'') IS NULL THEN NULL ELSE public.nv_network_key(p_network) END;
  v_since timestamptz := current_date::timestamptz - (greatest(1, least(coalesce(p_days,30), 3650)) - 1) * interval '1 day';
  v_prev_since timestamptz := current_date::timestamptz - ((greatest(1, least(coalesce(p_days,30), 3650)) * 2) - 1) * interval '1 day';
  v_until timestamptz := now() + interval '1 minute';
  v_data jsonb;
  v_total bigint := 0;
  v_network_sum bigint := 0;
  v_labeled bigint := 0;
  v_validation jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok',false,'message','Sessão expirada.');
  END IF;

  WITH base AS MATERIALIZED (
    SELECT
      si.id,
      si.user_id,
      public.nv_network_key(si.social_network) AS network,
      COALESCE(si.original_posted_at, si.created_at, si.collected_at) AS effective_at,
      COALESCE(NULLIF(si.comment_author,''), NULLIF(si.author_handle,''), NULLIF(si.author_name,''), si.id::text) AS author_key,
      COALESCE(si.likes_count,0)::bigint AS likes,
      COALESCE(si.replies_count,0)::bigint AS replies,
      COALESCE(si.shares_count,0)::bigint AS shares,
      COALESCE(public.network_view_sentiment(si.sentiment_label, si.sentiment_score, concat_ws(' ', si.comment_text, si.post_title, si.post_description)), 'neutral') AS sent,
      COALESCE(NULLIF(si.post_url,''), NULLIF(si.external_id,''), NULLIF(si.post_id,''), si.id::text) AS dedup_key
    FROM public.social_interactions si
    JOIN public.candidates c ON c.id = si.candidate_id
    WHERE COALESCE(si.original_posted_at, si.created_at, si.collected_at) >= v_prev_since
      AND COALESCE(si.original_posted_at, si.created_at, si.collected_at) < v_until
      AND si.invalidated_at IS NULL
      AND COALESCE(si.is_political_content, true) = true
      AND si.user_id IS NOT NULL
      AND si.candidate_id IS NOT NULL
      AND (v_is_admin OR si.user_id = v_uid)
      AND (p_candidate_id IS NULL OR si.candidate_id = p_candidate_id)
      AND (v_network IS NULL OR public.nv_network_key(si.social_network) = v_network)
      AND public.nv_network_key(si.social_network) NOT IN ('mastodon','lemmy','pinterest','gdelt')
  ), current_base AS MATERIALIZED (
    SELECT * FROM base WHERE effective_at >= v_since
  ), dedup_current AS MATERIALIZED (
    SELECT * FROM (
      SELECT b.*, row_number() OVER (PARTITION BY b.user_id, b.network, b.dedup_key ORDER BY (b.likes + b.replies + b.shares) DESC, b.effective_at DESC, b.id) AS rn
      FROM current_base b
    ) ranked WHERE rn = 1
  ), kpis AS (
    SELECT
      count(*)::bigint AS total,
      count(DISTINCT author_key)::bigint AS authors,
      coalesce((SELECT sum(likes + replies + shares) FROM dedup_current),0)::bigint AS engagement,
      coalesce((SELECT sum(likes) FROM dedup_current),0)::bigint AS likes,
      coalesce((SELECT sum(replies) FROM dedup_current),0)::bigint AS replies,
      coalesce((SELECT sum(shares) FROM dedup_current),0)::bigint AS shares,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS pos,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS neg,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS neu,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since) AS prev_total,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'positive') AS prev_pos,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'negative') AS prev_neg,
      (SELECT count(*)::bigint FROM base WHERE effective_at < v_since AND sent = 'neutral') AS prev_neu
    FROM current_base
  ), series AS (
    SELECT to_char(effective_at::date,'YYYY-MM-DD') AS day,
      count(*) FILTER (WHERE sent = 'positive')::bigint AS p,
      count(*) FILTER (WHERE sent = 'negative')::bigint AS n,
      count(*) FILTER (WHERE sent = 'neutral')::bigint AS u
    FROM current_base GROUP BY 1
  ), net_mentions AS (
    SELECT network, count(*)::bigint AS mentions FROM current_base GROUP BY 1
  ), net_engagement AS (
    SELECT network, sum(likes)::bigint AS likes, sum(replies)::bigint AS replies, sum(shares)::bigint AS shares, sum(likes + replies + shares)::bigint AS engagement
    FROM dedup_current GROUP BY 1
  ), by_net AS (
    SELECT m.network, m.mentions, coalesce(e.likes,0)::bigint AS likes, coalesce(e.replies,0)::bigint AS replies, coalesce(e.shares,0)::bigint AS shares, coalesce(e.engagement,0)::bigint AS engagement
    FROM net_mentions m LEFT JOIN net_engagement e USING (network)
  ), heat AS (
    SELECT extract(dow FROM effective_at)::int AS dow, extract(hour FROM effective_at)::int AS hr, count(*)::bigint AS c
    FROM current_base GROUP BY 1,2
  )
  SELECT jsonb_build_object(
    'kpis',(SELECT to_jsonb(kpis.*) FROM kpis),
    'series',(SELECT coalesce(jsonb_agg(to_jsonb(series.*) ORDER BY day),'[]'::jsonb) FROM series),
    'by_network',(SELECT coalesce(jsonb_agg(to_jsonb(by_net.*) ORDER BY mentions DESC),'[]'::jsonb) FROM by_net),
    'heatmap',(SELECT coalesce(jsonb_agg(to_jsonb(heat.*) ORDER BY dow,hr),'[]'::jsonb) FROM heat)
  ) INTO v_data;

  v_total := coalesce((v_data #>> '{kpis,total}')::bigint,0);
  v_labeled := coalesce((v_data #>> '{kpis,pos}')::bigint,0) + coalesce((v_data #>> '{kpis,neg}')::bigint,0) + coalesce((v_data #>> '{kpis,neu}')::bigint,0);
  SELECT coalesce(sum((item->>'mentions')::bigint),0) INTO v_network_sum FROM jsonb_array_elements(coalesce(v_data->'by_network','[]'::jsonb)) AS item;
  v_validation := jsonb_build_object('total_mentions',v_total,'network_sum',v_network_sum,'sentiment_sum',v_labeled,'network_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_network_sum - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END,'sentiment_diff_pct',CASE WHEN v_total > 0 THEN round(abs(v_labeled - v_total)::numeric / v_total::numeric * 100, 4) ELSE 0 END);

  IF v_total > 0 AND (abs(v_network_sum - v_total)::numeric / v_total::numeric > 0.01 OR abs(v_labeled - v_total)::numeric / v_total::numeric > 0.01) THEN
    RETURN jsonb_build_object('ok',false,'message','Dados em reprocessamento. Atualizando métricas. Recalculando agregações.','diagnostics',jsonb_build_object('source','social_interactions','validation',v_validation));
  END IF;

  RETURN jsonb_build_object('ok',true,'data',v_data,'diagnostics',jsonb_build_object('source','social_interactions','validation',v_validation));
END;
$$;

GRANT EXECUTE ON FUNCTION public.network_view_core_metrics_v12_impl(uuid,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.network_view_core_metrics(uuid,text,integer) TO authenticated;