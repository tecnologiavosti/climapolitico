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

    // Fetch ALL negative comments with pagination
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    let negativeComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_score, likes_count, replies_count, shares_count, social_network, original_posted_at, created_at')
        .eq('candidate_id', candidateId)
        .eq('sentiment_label', 'Negativo')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (pageError) {
        console.error('Error fetching comments:', pageError);
        break;
      }
      if (!page || page.length === 0) break;
      negativeComments = [...negativeComments, ...page];
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    // Also get total comments for context
    let totalComments = 0;
    let totalOffset = 0;
    while (true) {
      const { data: page } = await supabaseClient
        .from('social_interactions')
        .select('id', { count: 'exact', head: false })
        .eq('candidate_id', candidateId)
        .gte('created_at', startDate.toISOString())
        .range(totalOffset, totalOffset + pageSize - 1);
      if (!page || page.length === 0) break;
      totalComments += page.length;
      if (page.length < pageSize) break;
      totalOffset += pageSize;
    }

    if (negativeComments.length === 0) {
      return new Response(JSON.stringify({
        analysis: null,
        message: 'Nenhum comentário negativo encontrado no período selecionado.',
        stats: { totalComments, negativeCount: 0, rejectionRate: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const stats = {
      totalComments,
      negativeCount: negativeComments.length,
      rejectionRate: totalComments > 0 ? ((negativeComments.length / totalComments) * 100) : 0,
      byNetwork: {} as Record<string, number>,
    };

    negativeComments.forEach(c => {
      stats.byNetwork[c.social_network] = (stats.byNetwork[c.social_network] || 0) + 1;
    });

    // Sort by engagement for "most relevant"
    const sortedByRelevance = [...negativeComments]
      .filter(c => c.comment_text)
      .sort((a, b) => ((b.likes_count || 0) + (b.replies_count || 0)) - ((a.likes_count || 0) + (a.replies_count || 0)));

    const topNegative = sortedByRelevance.slice(0, 10).map(c => ({
      text: c.comment_text?.substring(0, 300),
      author: c.comment_author,
      network: c.social_network,
      likes: c.likes_count || 0,
      replies: c.replies_count || 0,
    }));

    // Sample for AI analysis (up to 200 negative comments)
    const sampleForAI = negativeComments
      .filter(c => c.comment_text)
      .slice(0, 200)
      .map(c => c.comment_text.substring(0, 250));

    const prompt = `Você é um analista político estratégico brasileiro. Analise os seguintes comentários NEGATIVOS reais sobre o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''} coletados nos últimos ${daysBack} dias.

CONTEXTO:
- Total de comentários no período: ${totalComments}
- Comentários negativos: ${negativeComments.length} (${stats.rejectionRate.toFixed(1)}% de rejeição)
- Redes sociais: ${Object.entries(stats.byNetwork).map(([k, v]) => `${k}: ${v}`).join(', ')}

AMOSTRA DE ${sampleForAI.length} COMENTÁRIOS NEGATIVOS:
${sampleForAI.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Analise profundamente esses comentários negativos e identifique padrões de rejeição.`;

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
          { role: 'system', content: 'Você é um analista político estratégico brasileiro especializado em gestão de crises e comunicação de campanha. Analise padrões de rejeição e críticas. Responda sempre em português do Brasil.' },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_rejection_analysis',
            description: 'Gerar análise estruturada de rejeição do candidato',
            parameters: {
              type: 'object',
              properties: {
                rejection_summary: {
                  type: 'string',
                  description: 'Resumo executivo de 2-3 frases explicando o panorama geral da rejeição'
                },
                rejection_themes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      theme: { type: 'string', description: 'Nome do tema de crítica (ex: economia, saúde, declaração polêmica)' },
                      description: { type: 'string', description: 'Descrição detalhada do motivo da crítica neste tema' },
                      frequency: { type: 'string', enum: ['alta', 'media', 'baixa'], description: 'Frequência com que este tema aparece' },
                      severity: { type: 'string', enum: ['critica', 'alta', 'moderada', 'baixa'], description: 'Severidade do impacto eleitoral' }
                    },
                    required: ['theme', 'description', 'frequency', 'severity']
                  },
                  description: '3-7 temas principais de crítica agrupados'
                },
                recurring_keywords: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '5-10 palavras-chave mais recorrentes nos comentários negativos'
                },
                crisis_points: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '2-4 pontos críticos que precisam de atenção imediata'
                },
                mitigation_strategies: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '3-5 estratégias para mitigar a rejeição identificada'
                },
                risk_level: {
                  type: 'string',
                  enum: ['critico', 'alto', 'moderado', 'baixo'],
                  description: 'Nível geral de risco da rejeição para a campanha'
                }
              },
              required: ['rejection_summary', 'rejection_themes', 'recurring_keywords', 'crisis_points', 'mitigation_strategies', 'risk_level']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_rejection_analysis' } }
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
      return new Response(JSON.stringify({ error: 'Erro ao gerar análise com IA' }), {
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

    const analysis = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({
      analysis,
      stats,
      topNegativeComments: topNegative,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error analyzing rejection:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
