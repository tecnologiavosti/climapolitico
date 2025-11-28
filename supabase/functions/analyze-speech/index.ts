import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to parse JWT payload (without validation)
function parseJWTPayload(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Create admin client for validation
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Extract and validate JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      const jwtPayload = parseJWTPayload(token);
      
      console.error('❌ Authentication failed:', {
        error: userError?.message || 'Auth session missing!',
        errorName: userError?.name,
        errorStatus: userError?.status,
        hasAuthHeader: true,
        authHeaderPreview: authHeader.substring(0, 20) + '...',
        jwtPayload: jwtPayload ? {
          exp: jwtPayload.exp,
          sub: jwtPayload.sub,
          iat: jwtPayload.iat
        } : null
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized - Invalid or expired session',
          details: userError?.message || 'JWT token validation failed'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Create user-scoped client for database operations
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
    
    // Multi-model analysis for cross-validation
    console.log('🤖 Calling 3 AI models for speech analysis cross-validation...');
    
    const aiPrompt = prompt + '\n\nRetorne JSON com: trigger_words, problematic_segments, psychological_impact, affected_voter_profiles, emotional_analysis, risk_level, recommended_actions, communication_suggestions, confidence';
    
    const [gemini3ProResponse, gpt5Response, geminiFlashResponse] = await Promise.all([
      fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-3-pro-preview',
          messages: [{ role: 'user', content: aiPrompt }]
        })
      }),
      fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-5',
          messages: [{ role: 'user', content: aiPrompt }]
        })
      }),
      fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [{ role: 'user', content: aiPrompt }]
        })
      })
    ]);
    
    const [gemini3ProData, gpt5Data, geminiFlashData] = await Promise.all([
      gemini3ProResponse.json(),
      gpt5Response.json(),
      geminiFlashResponse.json()
    ]);
    
    // Parse results from all models
    const parseResult = (data: any) => {
      const content = data.choices[0].message.content;
      return JSON.parse(content.includes('```') ? content.match(/\{[\s\S]*\}/)?.[0] || '{}' : content);
    };
    
    const gemini3ProResult = parseResult(gemini3ProData);
    const gpt5Result = parseResult(gpt5Data);
    const geminiFlashResult = parseResult(geminiFlashData);
    
    console.log('✅ All 3 models completed speech analysis');
    
    // Aggregate risk levels with weighted average (Gemini-3-Pro and GPT-5 have higher weight)
    const riskLevels = [
      { risk: gemini3ProResult.risk_level || 5, weight: 0.95 },
      { risk: gpt5Result.risk_level || 5, weight: 0.90 },
      { risk: geminiFlashResult.risk_level || 5, weight: 0.75 }
    ];
    const totalWeight = riskLevels.reduce((sum, r) => sum + r.weight, 0);
    const avgRiskLevel = Math.round(riskLevels.reduce((sum, r) => sum + (r.risk * r.weight), 0) / totalWeight);
    
    // Merge trigger words from all models
    const allTriggerWords = [
      ...(gemini3ProResult.trigger_words || []),
      ...(gpt5Result.trigger_words || []),
      ...(geminiFlashResult.trigger_words || [])
    ];
    
    // Use GPT-5 for primary analysis (most precise), supplement with others
    let analysisResult = {
      ...gpt5Result,
      risk_level: avgRiskLevel,
      trigger_words: allTriggerWords,
      confidence: Math.max(gemini3ProResult.confidence || 0, gpt5Result.confidence || 0, geminiFlashResult.confidence || 0)
    };

    const { data: saved } = await supabase.from('speech_analyses').insert({
      user_id: user.id,
      candidate_id: candidateId || null,
      speech_title: speechTitle || `Análise - ${new Date().toLocaleDateString()}`,
      speech_text: speechText || `Análise de ${postsAnalyzed || 0} posts`,
      source_type: mode,
      source_analysis_id: mode === 'social_media' ? analysisId : null,
      ...analysisResult,
      ai_model_used: 'multi-model: gemini-3-pro-preview, gpt-5, gemini-2.5-flash',
      ai_models_used: ['google/gemini-3-pro-preview', 'openai/gpt-5', 'google/gemini-2.5-flash']
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
