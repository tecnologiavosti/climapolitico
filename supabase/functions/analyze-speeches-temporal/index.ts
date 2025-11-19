import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      const jwtToken = authHeader ? authHeader.replace('Bearer ', '') : null;
      const jwtPayload = jwtToken ? parseJWTPayload(jwtToken) : null;
      
      console.error('❌ Authentication failed:', {
        error: authError?.message || 'Auth session missing!',
        errorName: authError?.name,
        errorStatus: authError?.status,
        hasAuthHeader: !!authHeader,
        authHeaderPreview: authHeader ? authHeader.substring(0, 20) + '...' : 'none',
        jwtPayload: jwtPayload ? {
          exp: jwtPayload.exp,
          sub: jwtPayload.sub,
          iat: jwtPayload.iat
        } : null
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized - Invalid or expired session',
          details: authError?.message || 'JWT token validation failed'
        }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { candidateId, startDate, endDate } = await req.json();

    if (!candidateId || !startDate || !endDate) {
      throw new Error('Missing required fields: candidateId, startDate, endDate');
    }

    console.log('Analyzing speeches for candidate:', candidateId, 'Period:', startDate, '-', endDate);

    // Fetch candidate info
    const { data: candidate, error: candidateError } = await supabase
      .from('candidates')
      .select('*')
      .eq('id', candidateId)
      .single();

    if (candidateError || !candidate) {
      throw new Error('Candidate not found');
    }

    // Fetch all analyses in the period
    const { data: analyses, error: analysesError } = await supabase
      .from('candidate_analyses')
      .select(`
        *,
        analysis_sources (*)
      `)
      .eq('candidate_id', candidateId)
      .eq('user_id', user.id)
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .eq('analysis_status', 'completed');

    if (analysesError) {
      console.error('Error fetching analyses:', analysesError);
      throw new Error('Failed to fetch analyses');
    }

    if (!analyses || analyses.length === 0) {
      throw new Error('No analyses found for this period');
    }

    console.log(`Found ${analyses.length} analyses in period`);

    // Aggregate data from all analyses
    const allKeywords: string[] = [];
    const allSocialNetworks = new Set<string>();
    let totalPosts = 0;
    let totalMentions = 0;

    for (const analysis of analyses) {
      if (analysis.keywords) allKeywords.push(...analysis.keywords);
      if (analysis.social_network) allSocialNetworks.add(analysis.social_network);
      totalPosts += analysis.posts_analyzed || 0;
      totalMentions += analysis.mentions_count || 0;
    }

    // Create AI prompt for temporal speech analysis
    const prompt = `Você é um especialista em análise de discurso político e comunicação estratégica.

CANDIDATO: ${candidate.full_name}
PARTIDO: ${candidate.party || 'N/A'}
REGIÃO: ${candidate.region || 'NACIONAL'}

PERÍODO DE ANÁLISE: ${startDate} até ${endDate}

CONTEXTO:
- ${analyses.length} análises de redes sociais foram realizadas neste período
- Total de posts analisados: ${totalPosts}
- Total de menções: ${totalMentions}
- Redes sociais: ${Array.from(allSocialNetworks).join(', ')}
- Palavras-chave identificadas: ${allKeywords.slice(0, 50).join(', ')}

SENTIMENTOS IDENTIFICADOS NOS PERÍODOS:
${analyses.map((a, i) => `Análise ${i + 1}: ${a.sentiment_label} (score: ${a.sentiment_score})`).join('\n')}

TAREFA:
Com base nos dados agregados das redes sociais, identifique as principais FALAS/DECLARAÇÕES do candidato neste período que geraram maior impacto (positivo ou negativo) nos usuários.

Para cada fala identificada, analise:
1. O texto da fala (baseado nas palavras-chave e contexto)
2. Reações dos usuários (sentimento detectado)
3. Palavras-gatilho problemáticas
4. Nível de risco (1-10)
5. Impacto psicológico
6. Perfis de eleitores afetados

Retorne no formato JSON especificado.`;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          type: 'function',
          function: {
            name: 'analyze_speeches_temporal',
            description: 'Analyze speeches in a time period with individual and aggregated results',
            parameters: {
              type: 'object',
              properties: {
                individual_speeches: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      speech_id: { type: 'string' },
                      speech_text: { type: 'string' },
                      post_date: { type: 'string' },
                      social_network: { type: 'string' },
                      reactions_count: { type: 'number' },
                      comments_count: { type: 'number' },
                      sentiment: { type: 'string', enum: ['Positivo', 'Neutro', 'Negativo'] },
                      trigger_words: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            word: { type: 'string' },
                            severity: { type: 'number' },
                            reason: { type: 'string' }
                          }
                        }
                      },
                      risk_level: { type: 'number' },
                      psychological_impact: { type: 'string' },
                      affected_profiles: { type: 'array', items: { type: 'string' } }
                    }
                  }
                },
                period_summary: {
                  type: 'object',
                  properties: {
                    total_speeches: { type: 'number' },
                    period: { type: 'string' },
                    avg_risk_level: { type: 'number' },
                    high_risk_speeches_count: { type: 'number' },
                    most_problematic_words: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          word: { type: 'string' },
                          frequency: { type: 'number' },
                          avg_severity: { type: 'number' }
                        }
                      }
                    },
                    overall_sentiment: { type: 'string', enum: ['Positivo', 'Neutro', 'Negativo'] },
                    sentiment_distribution: {
                      type: 'object',
                      properties: {
                        positive: { type: 'number' },
                        neutral: { type: 'number' },
                        negative: { type: 'number' }
                      }
                    },
                    recommendations: { type: 'array', items: { type: 'string' } }
                  }
                }
              },
              required: ['individual_speeches', 'period_summary']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'analyze_speeches_temporal' } }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI analysis failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices[0].message.tool_calls[0];
    const analysisResult = JSON.parse(toolCall.function.arguments);

    // Save to database
    const { data: savedAnalysis, error: saveError } = await supabase
      .from('speech_analyses')
      .insert({
        user_id: user.id,
        candidate_id: candidateId,
        speech_title: `Análise Temporal - ${candidate.full_name}`,
        speech_text: `Análise de falas do período ${startDate} a ${endDate}`,
        source_type: 'social_media',
        analysis_period_start: startDate,
        analysis_period_end: endDate,
        individual_speeches: analysisResult.individual_speeches,
        period_summary: analysisResult.period_summary,
        ai_model_used: 'google/gemini-2.5-flash',
        analysis_confidence: 0.85
      })
      .select()
      .single();

    if (saveError) {
      console.error('Error saving analysis:', saveError);
      throw new Error('Failed to save analysis');
    }

    console.log('Temporal speech analysis completed successfully');

    return new Response(JSON.stringify({
      success: true,
      analysis: savedAnalysis
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in analyze-speeches-temporal:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
