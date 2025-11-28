import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { candidateId, daysBack = 7 } = await req.json();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    console.log(`Generating insights for user ${user.id}, candidate ${candidateId || 'all'}, last ${daysBack} days`);

    // Buscar dados dos últimos N dias
    let candidatesQuery = supabaseClient
      .from('candidates')
      .select('*')
      .eq('user_id', user.id);
    
    if (candidateId) {
      candidatesQuery = candidatesQuery.eq('id', candidateId);
    }

    const { data: candidates, error: candidatesError } = await candidatesQuery;
    if (candidatesError) throw candidatesError;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: 'Nenhum candidato encontrado', insights: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const generatedInsights = [];

    for (const candidate of candidates) {
      // Buscar análises de sentimento
      const { data: analyses } = await supabaseClient
        .from('candidate_analyses')
        .select('*')
        .eq('candidate_id', candidate.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      // Buscar análises de fala
      const { data: speeches } = await supabaseClient
        .from('speech_analyses')
        .select('*')
        .eq('candidate_id', candidate.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      // Buscar rankings
      const { data: rankings } = await supabaseClient
        .from('candidate_rankings')
        .select('*')
        .eq('candidate_id', candidate.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false });

      // Buscar análises de indecisos
      const { data: undecided } = await supabaseClient
        .from('undecided_analyses')
        .select('*')
        .eq('candidate_id', candidate.id)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .limit(1);

      // Detectar padrões e gerar insights
      const insights = await detectPatterns({
        candidate,
        analyses: analyses || [],
        speeches: speeches || [],
        rankings: rankings || [],
        undecided: undecided?.[0],
        userId: user.id,
        supabaseClient
      });

      generatedInsights.push(...insights);
    }

    console.log(`Generated ${generatedInsights.length} insights`);

    return new Response(
      JSON.stringify({ insights: generatedInsights, count: generatedInsights.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating insights:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function detectPatterns({ candidate, analyses, speeches, rankings, undecided, userId, supabaseClient }: any) {
  const insights = [];
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

  // Detecção de Crise: Sentimento caiu >15% ou fala de alto risco
  if (analyses.length >= 2) {
    const latestSentiment = analyses[0]?.sentiment_score || 0;
    const previousSentiment = analyses[1]?.sentiment_score || 0;
    const sentimentChange = ((latestSentiment - previousSentiment) / Math.abs(previousSentiment || 1)) * 100;

    if (sentimentChange < -15) {
      const aiInsight = await generateAIInsight({
        type: 'crisis',
        candidate,
        data: { latestSentiment, previousSentiment, sentimentChange, analyses: analyses.slice(0, 3) },
        apiKey: LOVABLE_API_KEY
      });

      if (aiInsight) {
        const { error } = await supabaseClient.from('ai_insights').insert({
          user_id: userId,
          candidate_id: candidate.id,
          insight_type: 'crisis',
          priority: 'high',
          ...aiInsight
        });
        if (!error) insights.push(aiInsight);
      }
    }
  }

  // Detecção de Fala de Alto Risco
  const highRiskSpeeches = speeches.filter((s: any) => s.risk_level && s.risk_level > 7);
  if (highRiskSpeeches.length > 0) {
    const aiInsight = await generateAIInsight({
      type: 'crisis',
      candidate,
      data: { highRiskSpeeches, totalSpeeches: speeches.length },
      apiKey: LOVABLE_API_KEY
    });

    if (aiInsight) {
      const { error } = await supabaseClient.from('ai_insights').insert({
        user_id: userId,
        candidate_id: candidate.id,
        insight_type: 'crisis',
        priority: 'high',
        ...aiInsight
      });
      if (!error) insights.push(aiInsight);
    }
  }

  // Detecção de Oportunidade: Alto percentual de indecisos + sentimento positivo
  if (undecided && undecided.undecided_percentage > 20) {
    const latestSentiment = analyses[0]?.sentiment_score || 0;
    if (latestSentiment >= 0) {
      const aiInsight = await generateAIInsight({
        type: 'opportunity',
        candidate,
        data: { undecided, latestSentiment, analyses: analyses.slice(0, 2) },
        apiKey: LOVABLE_API_KEY
      });

      if (aiInsight) {
        const { error } = await supabaseClient.from('ai_insights').insert({
          user_id: userId,
          candidate_id: candidate.id,
          insight_type: 'opportunity',
          priority: 'medium',
          ...aiInsight
        });
        if (!error) insights.push(aiInsight);
      }
    }
  }

  // Detecção de Mudança de Ranking
  if (rankings.length >= 2) {
    const latestRank = rankings[0];
    const previousRank = rankings[1];
    const rankChange = previousRank.rank_position - latestRank.rank_position;

    if (Math.abs(rankChange) >= 3) {
      const aiInsight = await generateAIInsight({
        type: rankChange > 0 ? 'opportunity' : 'trend',
        candidate,
        data: { latestRank, previousRank, rankChange },
        apiKey: LOVABLE_API_KEY
      });

      if (aiInsight) {
        const { error } = await supabaseClient.from('ai_insights').insert({
          user_id: userId,
          candidate_id: candidate.id,
          insight_type: rankChange > 0 ? 'opportunity' : 'trend',
          priority: Math.abs(rankChange) >= 5 ? 'high' : 'medium',
          ...aiInsight
        });
        if (!error) insights.push(aiInsight);
      }
    }
  }

  return insights;
}

async function generateAIInsight({ type, candidate, data, apiKey }: any) {
  if (!apiKey) {
    console.error('LOVABLE_API_KEY not configured');
    return null;
  }

  let prompt = '';

  if (type === 'crisis' && data.sentimentChange) {
    prompt = `Você é um analista político estratégico. Com base nos seguintes dados sobre ${candidate.full_name}:

**ANÁLISE DE SENTIMENTO (Crise Detectada)**:
- Sentimento atual: ${data.latestSentiment}
- Sentimento anterior: ${data.previousSentiment}
- Variação: ${data.sentimentChange.toFixed(1)}%
- Menções totais: ${data.analyses[0]?.mentions_count || 0}
- Palavras-chave: ${data.analyses[0]?.keywords?.join(', ') || 'N/A'}

Gere um insight estratégico identificando:
1. O principal motivo da queda de sentimento
2. Impacto para a campanha
3. 2-3 ações práticas e específicas para reverter a situação
4. Score de confiança (0-100) baseado na qualidade dos dados`;

  } else if (type === 'crisis' && data.highRiskSpeeches) {
    const topRiskSpeech = data.highRiskSpeeches[0];
    prompt = `Você é um analista político estratégico. Com base nos seguintes dados sobre ${candidate.full_name}:

**ANÁLISE DE FALA DE ALTO RISCO**:
- Título da fala: ${topRiskSpeech.speech_title}
- Nível de risco: ${topRiskSpeech.risk_level}/10
- Score de percepção negativa: ${topRiskSpeech.negative_perception_score || 'N/A'}
- Palavras-gatilho: ${JSON.stringify(topRiskSpeech.trigger_words || [])}
- Total de falas de alto risco: ${data.highRiskSpeeches.length}

Gere um insight estratégico identificando:
1. Os principais problemas do discurso
2. Impacto potencial na campanha
3. 2-3 ações práticas para mitigar o dano
4. Score de confiança (0-100)`;

  } else if (type === 'opportunity') {
    if (data.undecided) {
      prompt = `Você é um analista político estratégico. Com base nos seguintes dados sobre ${candidate.full_name}:

**OPORTUNIDADE COM PÚBLICO INDECISO**:
- Percentual indeciso: ${data.undecided.undecided_percentage}%
- Sentimento atual: ${data.latestSentiment}
- Perfis indecisos: ${data.undecided.neutral_profiles_count || 0}
- Tópicos-chave: ${data.undecided.key_topics?.join(', ') || 'N/A'}

Gere um insight estratégico identificando:
1. A principal oportunidade de conversão
2. Perfil dos indecisos
3. 2-3 estratégias práticas de persuasão
4. Score de confiança (0-100)`;
    } else if (data.rankChange > 0) {
      prompt = `Você é um analista político estratégico. Com base nos seguintes dados sobre ${candidate.full_name}:

**MELHORA NO RANKING**:
- Posição anterior: ${data.previousRank.rank_position}
- Posição atual: ${data.latestRank.rank_position}
- Subiu: ${data.rankChange} posições
- Score geral: ${data.latestRank.overall_score}

Gere um insight estratégico identificando:
1. Os fatores do crescimento
2. Como manter o momentum
3. 2-3 ações para consolidar a posição
4. Score de confiança (0-100)`;
    }
  } else if (type === 'trend' && data.rankChange < 0) {
    prompt = `Você é um analista político estratégico. Com base nos seguintes dados sobre ${candidate.full_name}:

**QUEDA NO RANKING**:
- Posição anterior: ${data.previousRank.rank_position}
- Posição atual: ${data.latestRank.rank_position}
- Caiu: ${Math.abs(data.rankChange)} posições
- Score geral: ${data.latestRank.overall_score}

Gere um insight estratégico identificando:
1. As causas da queda
2. Impacto na campanha
3. 2-3 ações para reverter a tendência
4. Score de confiança (0-100)`;
  }

  if (!prompt) return null;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectModelForInsightType(type),
        messages: [
          { role: 'system', content: 'Você é um analista político estratégico. Responda em português do Brasil.' },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_insight',
            description: 'Criar um insight estratégico estruturado',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Título curto e impactante do insight' },
                description: { type: 'string', description: 'Descrição detalhada do insight' },
                recommended_actions: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '2-3 ações práticas e específicas'
                },
                confidence_score: { type: 'integer', description: 'Score de confiança 0-100' }
              },
              required: ['title', 'description', 'recommended_actions', 'confidence_score']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_insight' } }
      })
    });

    if (!response.ok) {
      console.error('AI API error:', response.status, await response.text());
      return null;
    }

    const result = await response.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall) {
      console.error('No tool call in AI response');
      return null;
    }

    const insightData = JSON.parse(toolCall.function.arguments);
    
    return {
      title: insightData.title,
      description: insightData.description,
      recommended_actions: insightData.recommended_actions,
      confidence_score: insightData.confidence_score,
      affected_candidates: [candidate.id],
      supporting_data: data
    };

  } catch (error) {
    console.error('Error calling AI:', error);
    return null;
  }
}

// Intelligent model selection based on insight type
function selectModelForInsightType(type: string): string {
  switch (type) {
    case 'crisis':
      // Critical analysis requires maximum precision
      return 'openai/gpt-5';
    case 'opportunity':
      // Strategic opportunities need advanced reasoning
      return 'google/gemini-3-pro-preview';
    case 'trend':
      // Trend analysis benefits from speed
      return 'google/gemini-2.5-flash';
    default:
      return 'google/gemini-2.5-flash';
  }
}