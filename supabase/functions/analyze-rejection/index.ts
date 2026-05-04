import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

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
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    const systemMsg = 'Você é um analista político estratégico brasileiro especializado em gestão de crises e comunicação de campanha. Analise padrões de rejeição e críticas. Responda sempre em português do Brasil.';

    const toolSchema = {
      type: 'object',
      properties: {
        rejection_summary: { type: 'string', description: 'Resumo executivo de 2-3 frases explicando o panorama geral da rejeição' },
        rejection_themes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              theme: { type: 'string' },
              description: { type: 'string' },
              frequency: { type: 'string', enum: ['alta', 'media', 'baixa'] },
              severity: { type: 'string', enum: ['critica', 'alta', 'moderada', 'baixa'] }
            },
            required: ['theme', 'description', 'frequency', 'severity']
          }
        },
        recurring_keywords: { type: 'array', items: { type: 'string' } },
        crisis_points: { type: 'array', items: { type: 'string' } },
        mitigation_strategies: { type: 'array', items: { type: 'string' } },
        risk_level: { type: 'string', enum: ['critico', 'alto', 'moderado', 'baixo'] }
      },
      required: ['rejection_summary', 'rejection_themes', 'recurring_keywords', 'crisis_points', 'mitigation_strategies', 'risk_level']
    };

    let analysis: any = null;
    let aiProvider = 'lovable';

    // Try Lovable AI first
    if (LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: prompt }
            ],
            tools: [{ type: 'function', function: { name: 'create_rejection_analysis', description: 'Gerar análise estruturada de rejeição', parameters: toolSchema } }],
            tool_choice: { type: 'function', function: { name: 'create_rejection_analysis' } }
          })
        });

        if (aiResponse.ok) {
          const result = await aiResponse.json();
          const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            analysis = JSON.parse(toolCall.function.arguments);
          } else {
            console.warn('Lovable AI: resposta sem tool_call, tentando Gemini fallback');
          }
        } else {
          const errText = await aiResponse.text();
          console.error('Lovable AI error:', aiResponse.status, errText, '— tentando Gemini fallback');
        }
      } catch (e) {
        console.error('Lovable AI exception:', e, '— tentando Gemini fallback');
      }
    }

    // Fallback: Gemini direct API — tenta múltiplos modelos em cascata
    if (!analysis && GEMINI_API_KEY) {
      const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.0-flash'];
      for (const model of geminiModels) {
        try {
          aiProvider = `gemini-direct:${model}`;
          const geminiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemMsg }] },
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                tools: [{ functionDeclarations: [{ name: 'create_rejection_analysis', description: 'Gerar análise estruturada de rejeição', parameters: toolSchema }] }],
                toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['create_rejection_analysis'] } }
              })
            }
          );
          if (geminiResponse.ok) {
            const gResult = await geminiResponse.json();
            const fnCall = gResult.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
            if (fnCall?.args) {
              analysis = fnCall.args;
              console.log(`✅ Gemini fallback sucesso com modelo: ${model}`);
              break;
            } else {
              console.warn(`Gemini ${model}: sem functionCall na resposta`);
            }
          } else {
            const errTxt = await geminiResponse.text();
            console.error(`Gemini ${model} error:`, geminiResponse.status, errTxt.substring(0, 200));
            if (geminiResponse.status !== 503 && geminiResponse.status !== 429) break;
          }
        } catch (e) {
          console.error(`Gemini ${model} exception:`, e);
        }
      }
    }

    if (!analysis) {
      return new Response(JSON.stringify({ error: 'Serviço de IA temporariamente indisponível. Tente novamente em instantes.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      analysis,
      stats,
      topNegativeComments: topNegative,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() },
      ai_provider: aiProvider
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error analyzing rejection:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
