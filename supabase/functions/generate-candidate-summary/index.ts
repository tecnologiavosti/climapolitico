import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Use SERVICE_ROLE for JWT validation (per project standard)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Não autorizado - sem token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    const supabaseClient = supabaseAdmin;
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { candidateId, daysBack = 7 } = await req.json();
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch candidate info
    const { data: candidate, error: candError } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region')
      .eq('id', candidateId)
      .eq('user_id', user.id)
      .single();

    if (candError || !candidate) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch ALL recent comments with pagination
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    let allComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_label, sentiment_score, likes_count, social_network, original_posted_at')
        .eq('candidate_id', candidateId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (pageError) {
        console.error('Error fetching comments:', pageError);
        break;
      }
      if (!page || page.length === 0) break;
      allComments = [...allComments, ...page];
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    if (allComments.length === 0) {
      return new Response(JSON.stringify({
        summary: null,
        message: 'Nenhum comentário encontrado no período selecionado.',
        stats: { total: 0, positive: 0, negative: 0, neutral: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Calculate stats
    const stats = {
      total: allComments.length,
      positive: allComments.filter(c => c.sentiment_label === 'Positivo').length,
      negative: allComments.filter(c => c.sentiment_label === 'Negativo').length,
      neutral: allComments.filter(c => c.sentiment_label === 'Neutro').length,
      withoutSentiment: allComments.filter(c => !c.sentiment_label).length,
    };

    // Sample comments for AI (max 150 to stay within token limits)
    const sampleSize = Math.min(150, allComments.length);
    const positiveComments = allComments
      .filter(c => c.sentiment_label === 'Positivo' && c.comment_text)
      .slice(0, 50)
      .map(c => c.comment_text.substring(0, 200));
    const negativeComments = allComments
      .filter(c => c.sentiment_label === 'Negativo' && c.comment_text)
      .slice(0, 50)
      .map(c => c.comment_text.substring(0, 200));
    const neutralComments = allComments
      .filter(c => c.sentiment_label === 'Neutro' && c.comment_text)
      .slice(0, 50)
      .map(c => c.comment_text.substring(0, 200));

    const prompt = `Você é um analista político estratégico brasileiro. Analise os seguintes comentários reais sobre o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` - ${candidate.region}` : ''} coletados nos últimos ${daysBack} dias.

ESTATÍSTICAS:
- Total de comentários: ${stats.total}
- Positivos: ${stats.positive} (${((stats.positive / stats.total) * 100).toFixed(1)}%)
- Negativos: ${stats.negative} (${((stats.negative / stats.total) * 100).toFixed(1)}%)
- Neutros: ${stats.neutral} (${((stats.neutral / stats.total) * 100).toFixed(1)}%)

AMOSTRA DE COMENTÁRIOS POSITIVOS (${positiveComments.length}):
${positiveComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

AMOSTRA DE COMENTÁRIOS NEGATIVOS (${negativeComments.length}):
${negativeComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

AMOSTRA DE COMENTÁRIOS NEUTROS (${neutralComments.length}):
${neutralComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Com base nesses dados REAIS, gere um resumo executivo completo para a equipe de campanha.`;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Chave de API não configurada' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'Você é um analista político estratégico brasileiro especializado em comunicação de campanha. Responda sempre em português do Brasil. Seja direto, prático e acionável.' },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_executive_summary',
            description: 'Gerar resumo executivo estruturado do candidato',
            parameters: {
              type: 'object',
              properties: {
                overall_sentiment: {
                  type: 'string',
                  enum: ['muito_positiva', 'positiva', 'mista', 'negativa', 'muito_negativa'],
                  description: 'Avaliação geral da repercussão'
                },
                overall_summary: {
                  type: 'string',
                  description: 'Resumo executivo em 2-3 frases sobre a situação geral do candidato'
                },
                positive_points: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '3-5 principais pontos positivos mencionados pelo público'
                },
                negative_points: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '3-5 principais críticas e pontos negativos identificados'
                },
                narrative_recommendations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '3-5 recomendações práticas de narrativa e comunicação'
                },
                risk_alert: {
                  type: 'string',
                  description: 'Alerta de risco principal, se houver. Caso contrário, retorne string vazia.'
                },
                opportunity_alert: {
                  type: 'string',
                  description: 'Principal oportunidade identificada. Caso contrário, retorne string vazia.'
                }
              },
              required: ['overall_sentiment', 'overall_summary', 'positive_points', 'negative_points', 'narrative_recommendations', 'risk_alert', 'opportunity_alert']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_executive_summary' } }
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errText);
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'Limite de requisições excedido. Tente novamente em alguns minutos.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'Créditos insuficientes. Adicione créditos à sua conta.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: 'Erro ao gerar resumo com IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await aiResponse.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      console.error('No tool call in AI response');
      return new Response(JSON.stringify({ error: 'Resposta inesperada da IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const summary = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({
      summary,
      stats,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error generating summary:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
