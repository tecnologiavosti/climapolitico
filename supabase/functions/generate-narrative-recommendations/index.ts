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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
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

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Fetch all comments with pagination
    let allComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, sentiment_label, sentiment_score, likes_count, replies_count, social_network')
        .eq('candidate_id', candidateId)
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (pageError) { console.error('Error:', pageError); break; }
      if (!page || page.length === 0) break;
      allComments = [...allComments, ...page];
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    if (allComments.length === 0) {
      return new Response(JSON.stringify({
        recommendations: null,
        message: 'Nenhum comentário encontrado no período selecionado.',
        stats: { total: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const stats = {
      total: allComments.length,
      positive: allComments.filter(c => c.sentiment_label === 'Positivo').length,
      negative: allComments.filter(c => c.sentiment_label === 'Negativo').length,
      neutral: allComments.filter(c => c.sentiment_label === 'Neutro').length,
    };

    // Sample negative comments (priority) and positive/neutral for context
    const negSample = allComments
      .filter(c => c.sentiment_label === 'Negativo' && c.comment_text)
      .sort((a, b) => ((b.likes_count || 0) + (b.replies_count || 0)) - ((a.likes_count || 0) + (a.replies_count || 0)))
      .slice(0, 100)
      .map(c => c.comment_text.substring(0, 250));

    const posSample = allComments
      .filter(c => c.sentiment_label === 'Positivo' && c.comment_text)
      .slice(0, 50)
      .map(c => c.comment_text.substring(0, 200));

    const neuSample = allComments
      .filter(c => c.sentiment_label === 'Neutro' && c.comment_text)
      .slice(0, 30)
      .map(c => c.comment_text.substring(0, 200));

    const prompt = `Você é um consultor de comunicação política brasileiro de alto nível. Analise os comentários reais sobre o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` - ${candidate.region}` : ''} e gere recomendações estratégicas de narrativa.

ESTATÍSTICAS DO PERÍODO (últimos ${daysBack} dias):
- Total: ${stats.total} comentários
- Positivos: ${stats.positive} (${((stats.positive / stats.total) * 100).toFixed(1)}%)
- Negativos: ${stats.negative} (${((stats.negative / stats.total) * 100).toFixed(1)}%)
- Neutros: ${stats.neutral} (${((stats.neutral / stats.total) * 100).toFixed(1)}%)

COMENTÁRIOS NEGATIVOS MAIS RELEVANTES (${negSample.length}):
${negSample.map((c, i) => `${i + 1}. ${c}`).join('\n')}

COMENTÁRIOS POSITIVOS (${posSample.length}):
${posSample.map((c, i) => `${i + 1}. ${c}`).join('\n')}

COMENTÁRIOS NEUTROS (${neuSample.length}):
${neuSample.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Com base nos dados REAIS acima, gere recomendações concretas e específicas de narrativa. NÃO faça sugestões genéricas. Cada recomendação deve ser baseada em padrões encontrados nos comentários.`;

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
          { role: 'system', content: 'Você é um consultor de comunicação política brasileiro de alto nível. Gere recomendações práticas, específicas e acionáveis baseadas exclusivamente nos dados reais fornecidos. Responda sempre em português do Brasil.' },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_narrative_recommendations',
            description: 'Gerar recomendações estruturadas de narrativa para o candidato',
            parameters: {
              type: 'object',
              properties: {
                situation_summary: {
                  type: 'string',
                  description: 'Resumo em 2-3 frases da situação atual de percepção pública do candidato'
                },
                topics_to_avoid: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      topic: { type: 'string', description: 'Tema a evitar' },
                      reason: { type: 'string', description: 'Por que evitar, baseado nos comentários reais' },
                      urgency: { type: 'string', enum: ['imediata', 'alta', 'moderada'], description: 'Urgência' }
                    },
                    required: ['topic', 'reason', 'urgency']
                  },
                  description: '2-5 temas que o candidato deve evitar nas próximas falas'
                },
                topics_to_reinforce: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      topic: { type: 'string', description: 'Tema a reforçar' },
                      reason: { type: 'string', description: 'Por que reforçar, baseado nos comentários reais' },
                      suggested_approach: { type: 'string', description: 'Como abordar o tema de forma eficaz' }
                    },
                    required: ['topic', 'reason', 'suggested_approach']
                  },
                  description: '2-5 temas que o candidato deve reforçar'
                },
                responses_to_criticism: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      criticism: { type: 'string', description: 'A crítica recorrente identificada' },
                      suggested_response: { type: 'string', description: 'Como responder ou endereçar a crítica' },
                      tone: { type: 'string', enum: ['firme', 'conciliador', 'educativo', 'empático'], description: 'Tom recomendado' }
                    },
                    required: ['criticism', 'suggested_response', 'tone']
                  },
                  description: '2-5 respostas recomendadas para críticas recorrentes'
                },
                communication_plan: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      action: { type: 'string', description: 'Ação concreta de comunicação' },
                      channel: { type: 'string', description: 'Canal recomendado (rede social, imprensa, evento, etc.)' },
                      priority: { type: 'string', enum: ['critica', 'alta', 'media', 'baixa'], description: 'Prioridade' },
                      expected_impact: { type: 'string', description: 'Impacto esperado da ação' }
                    },
                    required: ['action', 'channel', 'priority', 'expected_impact']
                  },
                  description: '3-6 ações concretas de comunicação priorizadas'
                },
                key_message: {
                  type: 'string',
                  description: 'A mensagem-chave principal que deve nortear toda a comunicação do candidato neste momento'
                }
              },
              required: ['situation_summary', 'topics_to_avoid', 'topics_to_reinforce', 'responses_to_criticism', 'communication_plan', 'key_message']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_narrative_recommendations' } }
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
        return new Response(JSON.stringify({ error: 'Créditos insuficientes.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      return new Response(JSON.stringify({ error: 'Erro ao gerar recomendações com IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const result = await aiResponse.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      return new Response(JSON.stringify({ error: 'Resposta inesperada da IA' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const recommendations = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({
      recommendations,
      stats,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
