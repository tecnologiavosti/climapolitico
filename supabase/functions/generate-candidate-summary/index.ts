import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const CEREBRAS_MODELS = ["qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "llama3.1-8b"];

async function callCerebrasSummary(prompt: string) {
  const systemMsg = 'Você é um analista político estratégico brasileiro especializado em comunicação de campanha. Responda sempre em português do Brasil. Seja direto, prático e acionável. Responda SEMPRE em JSON válido seguindo o schema solicitado.';
  const fullPrompt = `${prompt}\n\nResponda EXCLUSIVAMENTE com um JSON no formato:\n{"overall_sentiment":"muito_positiva|positiva|mista|negativa|muito_negativa","overall_summary":"...","positive_points":["..."],"negative_points":["..."],"narrative_recommendations":["..."],"risk_alert":"...","opportunity_alert":"..."}`;
  const result = await callAICerebrasFirst({
    systemMsg,
    userPrompt: fullPrompt,
    jsonMode: true,
    maxTokens: 2000,
    temperature: 0.5,
    cerebrasModels: CEREBRAS_MODELS,
    tag: 'summary',
  });
  const parsed = JSON.parse(result.content || '{}');
  return { summary: parsed, model_used: `${result.provider}/${result.model}` };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Models in order of preference (fallback if rate-limited)
const MODEL_FALLBACKS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-flash-lite',
  'google/gemini-2.5-pro',
];

function buildDeterministicSummary(stats: any, candidate: any, periodLabel: string) {
  const total = stats.total || 1;
  const pPct = ((stats.positive / total) * 100).toFixed(1);
  const nPct = ((stats.negative / total) * 100).toFixed(1);
  const neuPct = ((stats.neutral / total) * 100).toFixed(1);

  let overall_sentiment = 'mista';
  if (stats.positive > stats.negative * 2) overall_sentiment = 'muito_positiva';
  else if (stats.positive > stats.negative) overall_sentiment = 'positiva';
  else if (stats.negative > stats.positive * 2) overall_sentiment = 'muito_negativa';
  else if (stats.negative > stats.positive) overall_sentiment = 'negativa';

  return {
    overall_sentiment,
    overall_summary: `Análise quantitativa de ${stats.total} comentários sobre ${candidate.full_name} (${periodLabel}): ${pPct}% positivos, ${neuPct}% neutros, ${nPct}% negativos. Resumo gerado em modo offline (IA temporariamente indisponível por limite de uso).`,
    positive_points: [
      `${stats.positive} comentários positivos identificados (${pPct}% do total)`,
      'Engajamento positivo presente nas interações coletadas',
      'Base de apoiadores ativa nas redes sociais monitoradas',
    ],
    negative_points: [
      `${stats.negative} comentários negativos identificados (${nPct}% do total)`,
      'Críticas registradas requerem atenção da equipe de campanha',
      stats.negative > stats.positive ? 'Volume negativo supera o positivo no período' : 'Críticas pontuais distribuídas no período',
    ],
    narrative_recommendations: [
      'Aguarde alguns minutos e gere novamente para obter análise de IA detalhada com os comentários reais',
      'Monitore os comentários negativos manualmente para identificar temas recorrentes',
      'Reforce os tópicos com maior receptividade positiva nas próximas comunicações',
    ],
    risk_alert: stats.negative > stats.positive ? 'Volume de menções negativas superior ao positivo no período analisado.' : '',
    opportunity_alert: stats.positive > stats.negative * 1.5 ? 'Sentimento favorável dominante — momento oportuno para amplificar mensagens-chave.' : '',
  };
}

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    overall_sentiment: { type: 'string', enum: ['muito_positiva', 'positiva', 'mista', 'negativa', 'muito_negativa'] },
    overall_summary: { type: 'string' },
    positive_points: { type: 'array', items: { type: 'string' } },
    negative_points: { type: 'array', items: { type: 'string' } },
    narrative_recommendations: { type: 'array', items: { type: 'string' } },
    risk_alert: { type: 'string' },
    opportunity_alert: { type: 'string' }
  },
  required: ['overall_sentiment', 'overall_summary', 'positive_points', 'negative_points', 'narrative_recommendations', 'risk_alert', 'opportunity_alert']
};

async function callLovableAI(prompt: string, apiKey: string) {
  const tools = [{
    type: 'function',
    function: {
      name: 'create_executive_summary',
      description: 'Gerar resumo executivo estruturado do candidato',
      parameters: SUMMARY_SCHEMA
    }
  }];

  let lastError: any = null;
  for (const model of MODEL_FALLBACKS) {
    try {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Você é um analista político estratégico brasileiro especializado em comunicação de campanha. Responda sempre em português do Brasil. Seja direto, prático e acionável.' },
            { role: 'user', content: prompt }
          ],
          tools,
          tool_choice: { type: 'function', function: { name: 'create_executive_summary' } }
        })
      });

      if (aiResponse.status === 429 || aiResponse.status === 402) {
        lastError = { status: aiResponse.status, model };
        console.warn(`[Lovable AI] ${model} returned ${aiResponse.status}, trying next...`);
        continue;
      }

      if (!aiResponse.ok) {
        const errText = await aiResponse.text();
        console.error(`[Lovable AI] ${model} error ${aiResponse.status}:`, errText);
        lastError = { status: aiResponse.status, model };
        continue;
      }

      const result = await aiResponse.json();
      const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        lastError = { status: 'no_tool_call', model };
        continue;
      }
      return { summary: JSON.parse(toolCall.function.arguments), model_used: `lovable/${model}` };
    } catch (e) {
      console.error(`[Lovable AI] ${model} exception:`, e);
      lastError = e;
    }
  }
  throw lastError || new Error('All Lovable AI models failed');
}

// Direct Google Gemini API fallback (uses GEMINI_API_KEY from aistudio.google.com)
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];

async function callGeminiDirect(prompt: string, geminiKey: string) {
  let lastError: any = null;
  for (const model of GEMINI_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: 'Você é um analista político estratégico brasileiro especializado em comunicação de campanha. Responda sempre em português do Brasil. Seja direto, prático e acionável.' }]
          },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: SUMMARY_SCHEMA,
            temperature: 0.7,
          }
        })
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.warn(`[Gemini Direct] ${model} returned ${resp.status}:`, errText.substring(0, 300));
        lastError = { status: resp.status, model };
        continue;
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        lastError = { status: 'no_text', model };
        continue;
      }
      const parsed = JSON.parse(text);
      return { summary: parsed, model_used: `gemini-direct/${model}` };
    } catch (e) {
      console.error(`[Gemini Direct] ${model} exception:`, e);
      lastError = e;
    }
  }
  throw lastError || new Error('All Gemini Direct models failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // daysBack: number | null. null = todos os tempos
    // Also supports custom startDate/endDate (ISO strings)
    const body = await req.json();
    const candidateId = body.candidateId;
    const daysBack: number | null = body.daysBack === null || body.daysBack === 'all' || body.daysBack === 0
      ? null
      : Number(body.daysBack ?? 7);
    const customStart: string | null = body.startDate ?? null;
    const customEnd: string | null = body.endDate ?? null;

    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: candidate, error: candError } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region, user_id')
      .eq('id', candidateId)
      .maybeSingle();

    if (candError) {
      console.error('[SUMMARY] DB error:', candError);
      return new Response(JSON.stringify({ error: 'Erro ao buscar candidato', details: candError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (!candidate) {
      console.warn(`[SUMMARY] Candidato ${candidateId} não existe na base`);
      return new Response(JSON.stringify({ error: 'Candidato não encontrado', candidateId }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (candidate.user_id !== user.id) {
      console.warn(`[SUMMARY] Candidato ${candidateId} pertence a ${candidate.user_id}, requisitado por ${user.id}`);
      return new Response(JSON.stringify({ error: 'Candidato pertence a outro usuário' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    let startDate: Date | null = null;
    let endDate: Date | null = null;
    let periodLabel = 'período total (todos os tempos)';
    if (customStart || customEnd) {
      startDate = customStart ? new Date(customStart) : null;
      endDate = customEnd ? new Date(customEnd) : null;
      const fmt = (d: Date) => d.toLocaleDateString('pt-BR');
      periodLabel = `período personalizado (${startDate ? fmt(startDate) : '...'} a ${endDate ? fmt(endDate) : 'hoje'})`;
    } else if (daysBack !== null && daysBack > 0) {
      startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);
      periodLabel = `últimos ${daysBack} dias`;
    }

    let allComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      let q = supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_label, sentiment_score, likes_count, social_network, original_posted_at')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (startDate) q = q.gte('created_at', startDate.toISOString());

      const { data: page, error: pageError } = await q;
      if (pageError) { console.error('Error fetching comments:', pageError); break; }
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

    const positive = allComments.filter(c => c.sentiment_label === 'Positivo').length;
    const negative = allComments.filter(c => c.sentiment_label === 'Negativo').length;
    const neutral = allComments.filter(c => c.sentiment_label === 'Neutro').length;
    const withoutSentiment = allComments.filter(c => !c.sentiment_label).length;
    // total exibido = soma das três classes (pos+neu+neg). Garante que a soma sempre bata.
    const stats = {
      total: positive + negative + neutral,
      positive,
      negative,
      neutral,
      withoutSentiment,
      totalCollected: allComments.length,
    };

    const positiveComments = allComments.filter(c => c.sentiment_label === 'Positivo' && c.comment_text).slice(0, 50).map(c => c.comment_text.substring(0, 200));
    const negativeComments = allComments.filter(c => c.sentiment_label === 'Negativo' && c.comment_text).slice(0, 50).map(c => c.comment_text.substring(0, 200));
    const neutralComments = allComments.filter(c => c.sentiment_label === 'Neutro' && c.comment_text).slice(0, 50).map(c => c.comment_text.substring(0, 200));

    const prompt = `Você é um analista político estratégico brasileiro. Analise os seguintes comentários reais sobre o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` - ${candidate.region}` : ''} coletados no ${periodLabel}.

ESTATÍSTICAS:
- Total: ${stats.total}
- Positivos: ${stats.positive} (${((stats.positive / stats.total) * 100).toFixed(1)}%)
- Negativos: ${stats.negative} (${((stats.negative / stats.total) * 100).toFixed(1)}%)
- Neutros: ${stats.neutral} (${((stats.neutral / stats.total) * 100).toFixed(1)}%)

POSITIVOS (${positiveComments.length}):
${positiveComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

NEGATIVOS (${negativeComments.length}):
${negativeComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

NEUTROS (${neutralComments.length}):
${neutralComments.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Gere um resumo executivo completo para a equipe de campanha.`;

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');

    let summary: any;
    let modelUsed = 'fallback_deterministic';
    let fallbackUsed = false;

    // 1. PRIMÁRIO: Cerebras (alta capacidade), com fallback automático para Lovable AI
    try {
      const aiResult = await callCerebrasSummary(prompt);
      summary = aiResult.summary;
      modelUsed = aiResult.model_used;
    } catch (e: any) {
      console.warn('[SUMMARY] Cerebras+Lovable falharam, tentando Lovable AI tool-calling...', e?.message || e);
    }

    // 2. Fallback secundário: Lovable AI Gateway com tool-calling estruturado
    if (!summary && LOVABLE_API_KEY) {
      try {
        const aiResult = await callLovableAI(prompt, LOVABLE_API_KEY);
        summary = aiResult.summary;
        modelUsed = aiResult.model_used;
      } catch (e: any) {
        console.warn('[SUMMARY] Lovable AI tool-calling falhou, tentando Gemini direto...', e?.status || e);
      }
    }

    // 3. Fallback: Google Gemini API direta
    if (!summary && GEMINI_API_KEY) {
      try {
        const aiResult = await callGeminiDirect(prompt, GEMINI_API_KEY);
        summary = aiResult.summary;
        modelUsed = aiResult.model_used;
      } catch (e: any) {
        console.warn('[SUMMARY] Gemini direto falhou, usando fallback determinístico:', e?.status || e);
      }
    }

    // 4. Fallback determinístico (offline)
    if (!summary) {
      summary = buildDeterministicSummary(stats, candidate, periodLabel);
      fallbackUsed = true;
    }

    return new Response(JSON.stringify({
      summary,
      stats,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate?.toISOString() ?? null, endDate: new Date().toISOString(), label: periodLabel },
      model_used: modelUsed,
      fallback_used: fallbackUsed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error generating summary:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
