import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizeRegion(region: string | null): string {
  if (!region) return 'NACIONAL';
  const normalized = region.trim().toUpperCase();
  const regionMap: Record<string, string> = {
    'BRASIL': 'NACIONAL', 'BR': 'NACIONAL', 'NACIONAL': 'NACIONAL',
    'DF': 'DISTRITO FEDERAL', 'SP': 'SÃO PAULO', 'RJ': 'RIO DE JANEIRO'
  };
  return regionMap[normalized] || normalized;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('No authorization header');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { mode = 'manual', speechText, speechTitle, candidateId, speechDate, speechType, analysisId, keywords, postsAnalyzed, sentimentLabel, socialNetworks } = await req.json();

    if (mode === 'manual' && (!speechText || !speechTitle)) {
      throw new Error('speechText and speechTitle required');
    }
    if (mode === 'social_media' && (!analysisId || !candidateId)) {
      throw new Error('analysisId and candidateId required');
    }

    let candidate = null;
    let candidateRegion = 'NACIONAL';
    
    if (candidateId) {
      const { data } = await supabase.from('candidates').select('full_name, region, party').eq('id', candidateId).maybeSingle();
      candidate = data;
      if (candidate) candidateRegion = normalizeRegion(candidate.region);
    }

    let prompt = mode === 'social_media' 
      ? `Analise dados de redes sociais: ${postsAnalyzed || 0} posts, keywords: ${(keywords || []).join(', ')}, sentimento: ${sentimentLabel}`
      : `Analise a fala: "${speechText}"`;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt + '\n\nRetorne JSON com: trigger_words, problematic_segments, psychological_impact, affected_voter_profiles, emotional_analysis, risk_level, recommended_actions, communication_suggestions, confidence' }]
      })
    });

    const aiData = await aiResponse.json();
    const content = aiData.choices[0].message.content;
    let analysisResult = JSON.parse(content.includes('```') ? content.match(/\{[\s\S]*\}/)?.[0] || '{}' : content);

    const { data: saved } = await supabase.from('speech_analyses').insert({
      user_id: user.id,
      candidate_id: candidateId || null,
      speech_title: speechTitle || `Análise - ${new Date().toLocaleDateString()}`,
      speech_text: speechText || `Análise de ${postsAnalyzed || 0} posts`,
      source_type: mode,
      source_analysis_id: mode === 'social_media' ? analysisId : null,
      ...analysisResult,
      ai_model_used: 'google/gemini-2.5-flash'
    }).select().single();

    return new Response(JSON.stringify({ success: true, analysis: saved }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error in analyze-speech:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
