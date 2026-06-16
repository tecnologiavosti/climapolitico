CREATE OR REPLACE FUNCTION public.network_view_analytics(
  p_candidate_id uuid DEFAULT NULL::uuid,
  p_network text DEFAULT NULL::text,
  p_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_summary jsonb;
  v_sentiment jsonb;
  v_engagement jsonb;
  v_heatmap jsonb;
  v_topics jsonb;
  v_hashtags jsonb;
  v_kpis jsonb;
BEGIN
  v_summary := public.network_view_summary(p_candidate_id, p_network, p_days);
  v_sentiment := public.network_view_sentiment_block(p_candidate_id, p_network, p_days);
  v_engagement := public.network_view_engagement_block(p_candidate_id, p_network, p_days);
  v_heatmap := public.network_view_heatmap_block(p_candidate_id, p_network, p_days);
  v_topics := public.network_view_topics_block(p_candidate_id, p_network, p_days);
  v_hashtags := public.network_view_hashtags_block(p_candidate_id, p_network, p_days);
  v_kpis := coalesce(v_summary #> '{data,kpis}', '{}'::jsonb) || coalesce(v_sentiment #> '{data,kpis}', '{}'::jsonb);

  RETURN jsonb_build_object(
    'ok', coalesce((v_summary->>'ok')::boolean, false),
    'data', jsonb_build_object(
      'kpis', v_kpis,
      'series', coalesce(v_sentiment #> '{data,series}', '[]'::jsonb),
      'by_network', coalesce(v_engagement #> '{data,by_network}', '[]'::jsonb),
      'heatmap', coalesce(v_heatmap #> '{data,heatmap}', '[]'::jsonb),
      'topics', coalesce(v_topics #> '{data,topics}', '[]'::jsonb),
      'hashtags', coalesce(v_hashtags #> '{data,hashtags}', '[]'::jsonb),
      'debug', coalesce(v_summary #> '{data,debug}', '{}'::jsonb),
      'analytics', jsonb_build_object(
        'mentions', v_kpis,
        'engagement', coalesce(v_engagement #> '{data,by_network}', '[]'::jsonb),
        'sentiment', coalesce(v_sentiment #> '{data,kpis}', '{}'::jsonb),
        'themes', coalesce(v_topics #> '{data,topics}', '[]'::jsonb),
        'hashtags', coalesce(v_hashtags #> '{data,hashtags}', '[]'::jsonb)
      )
    ),
    'diagnostics', jsonb_build_object(
      'source', 'network_view_parallel_blocks',
      'sections', jsonb_build_object('summary', v_summary->'diagnostics', 'sentiment', v_sentiment->'diagnostics', 'engagement', v_engagement->'diagnostics', 'heatmap', v_heatmap->'diagnostics', 'topics', v_topics->'diagnostics', 'hashtags', v_hashtags->'diagnostics'),
      'ai_prompt_guardrail', 'Use SOMENTE o analytics JSON atual. Não use cache antigo. Não use memória. Não invente métricas.'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.network_view_analytics(uuid,text,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.network_view_analytics(uuid,text,integer) TO authenticated, service_role;