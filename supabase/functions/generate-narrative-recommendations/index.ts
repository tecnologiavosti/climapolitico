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
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    const systemMsg = 'Você é um consultor de comunicação política brasileiro de alto nível. Gere recomendações práticas, específicas e acionáveis baseadas exclusivamente nos dados reais fornecidos. Responda sempre em português do Brasil.';

    const toolSchema = {
      type: 'object',
      properties: {
        situation_summary: { type: 'string' },
        topics_to_avoid: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              reason: { type: 'string' },
              urgency: { type: 'string', enum: ['imediata', 'alta', 'moderada'] }
            },
            required: ['topic', 'reason', 'urgency']
          }
        },
        topics_to_reinforce: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic: { type: 'string' },
              reason: { type: 'string' },
              suggested_approach: { type: 'string' }
            },
            required: ['topic', 'reason', 'suggested_approach']
          }
        },
        responses_to_criticism: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              criticism: { type: 'string' },
              suggested_response: { type: 'string' },
              tone: { type: 'string', enum: ['firme', 'conciliador', 'educativo', 'empático'] }
            },
            required: ['criticism', 'suggested_response', 'tone']
          }
        },
        communication_plan: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string' },
              channel: { type: 'string' },
              priority: { type: 'string', enum: ['critica', 'alta', 'media', 'baixa'] },
              expected_impact: { type: 'string' }
            },
            required: ['action', 'channel', 'priority', 'expected_impact']
          }
        },
        key_message: { type: 'string' }
      },
      required: ['situation_summary', 'topics_to_avoid', 'topics_to_reinforce', 'responses_to_criticism', 'communication_plan', 'key_message']
    };

    let recommendations: any = null;
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
            tools: [{ type: 'function', function: { name: 'create_narrative_recommendations', description: 'Gerar recomendações de narrativa', parameters: toolSchema } }],
            tool_choice: { type: 'function', function: { name: 'create_narrative_recommendations' } }
          })
        });

        if (aiResponse.ok) {
          const result = await aiResponse.json();
          const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
          if (toolCall) {
            recommendations = JSON.parse(toolCall.function.arguments);
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

    // Fallback: Gemini direct API
    if (!recommendations && GEMINI_API_KEY) {
      try {
        aiProvider = 'gemini-direct';
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemMsg }] },
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              tools: [{ functionDeclarations: [{ name: 'create_narrative_recommendations', description: 'Gerar recomendações de narrativa', parameters: toolSchema }] }],
              toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['create_narrative_recommendations'] } }
            })
          }
        );
        if (geminiResponse.ok) {
          const gResult = await geminiResponse.json();
          const fnCall = gResult.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
          if (fnCall?.args) recommendations = fnCall.args;
        } else {
          console.error('Gemini fallback error:', geminiResponse.status, await geminiResponse.text());
        }
      } catch (e) {
        console.error('Gemini fallback exception:', e);
      }
    }

    if (!recommendations) {
      return new Response(JSON.stringify({ error: 'Serviço de IA temporariamente indisponível. Tente novamente em instantes.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      recommendations,
      stats,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() },
      ai_provider: aiProvider
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
