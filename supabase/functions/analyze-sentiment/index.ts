import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIChatCompat } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const isUnlimitedTier = (tier?: string | null) =>
  ['vip', 'lifetime', 'vitalicio', 'vitalício'].includes(String(tier ?? '').toLowerCase().trim());

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('❌ Missing Authorization header');
      return new Response(
        JSON.stringify({ error: 'Autenticação necessária' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with service role for validation
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.error('❌ Invalid token:', authError?.message);
      return new Response(
        JSON.stringify({ error: 'Token inválido ou expirado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ User authenticated:', user.id);

    // Check subscription limits
    const { data: subscription, error: subError } = await supabase
      .from('subscriptions')
      .select('tier, max_updates_per_month, updates_used_this_month, status')
      .eq('user_id', user.id)
      .single();

    if (subError || !subscription) {
      console.error('❌ Subscription not found:', subError?.message);
      return new Response(
        JSON.stringify({ error: 'Assinatura não encontrada' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (subscription.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'Assinatura inativa. Por favor, renove sua assinatura.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const unlimitedPlan = isUnlimitedTier(subscription.tier);

    if (!unlimitedPlan && subscription.updates_used_this_month >= subscription.max_updates_per_month) {
      return new Response(
        JSON.stringify({ 
          error: 'Limite mensal de análises atingido',
          details: `Você usou ${subscription.updates_used_this_month}/${subscription.max_updates_per_month} análises este mês.`
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { texts, analysisType = 'sentiment' } = await req.json();
    console.log('Received request:', { textsCount: texts?.length, analysisType, userId: user.id });

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'O array de textos é obrigatório e não pode estar vazio' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Rate limit: max 50 texts per request
    if (texts.length > 50) {
      return new Response(
        JSON.stringify({ error: 'Máximo de 50 textos por requisição' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'Serviço de IA não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let systemPrompt = '';
    if (analysisType === 'sentiment') {
      systemPrompt = `Você é um especialista em análise de sentimento político brasileiro. 
Analise cada texto e retorne um JSON array com os seguintes campos para cada texto:
- sentiment: "positive", "negative" ou "neutral"
- confidence: número de 0 a 1 indicando confiança na análise
- keywords: array com até 5 palavras-chave principais do texto
- reasoning: breve explicação da classificação (máximo 100 caracteres)

Seja preciso e objetivo. Considere o contexto político brasileiro.`;
    } else if (analysisType === 'ideology') {
      systemPrompt = `Você é um especialista em análise política brasileira.
Analise cada texto e identifique a tendência ideológica implícita.
Retorne um JSON array com os seguintes campos para cada texto:
- ideology: "left", "right", "center" ou "neutral"
- confidence: número de 0 a 1 indicando confiança na análise
- indicators: array com indicadores que levaram à classificação
- reasoning: breve explicação (máximo 100 caracteres)

Base-se em pautas, vocabulário e posicionamentos típicos do cenário político brasileiro.`;
    }

    // Prepare the prompt with all texts
    const userPrompt = `Analise os seguintes textos:\n\n${texts.map((text: string, idx: number) => `${idx + 1}. "${text}"`).join('\n\n')}

Retorne APENAS um JSON array válido, sem texto adicional.`;

    console.log('Calling Lovable AI...');
    
    let aiResponse = "";
    try {
      const data = await callAIChatCompat({
        systemMsg: systemPrompt,
        userPrompt,
        jsonMode: false,
        temperature: 0.3,
        maxTokens: 2000,
        tag: "analyze-sentiment",
      });
      aiResponse = data.choices?.[0]?.message?.content ?? "";
      console.log(`AI response received via ${data.provider}:${data.model}`);
    } catch (e) {
      const msg = (e as Error).message || "AI indisponível";
      console.error("AI providers exhausted:", msg);
      const status = /créditos/i.test(msg) ? 402 : /limite/i.test(msg) ? 429 : 503;
      return new Response(
        JSON.stringify({ error: msg }),
        { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!aiResponse) {
      return new Response(
        JSON.stringify({ error: 'Resposta de IA inválida' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the AI response as JSON
    let results;
    try {
      // Try to extract JSON from the response (sometimes AI wraps it in markdown)
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      const jsonString = jsonMatch ? jsonMatch[0] : aiResponse;
      results = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      console.log('Raw response:', aiResponse);
      return new Response(
        JSON.stringify({ error: 'Falha ao processar resposta da IA', rawResponse: aiResponse }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Increment usage counter. VIP/Vitalício não consome créditos.
    if (!unlimitedPlan) {
      await supabase
        .from('subscriptions')
        .update({ updates_used_this_month: subscription.updates_used_this_month + 1 })
        .eq('user_id', user.id);
    }

    console.log('Analysis complete:', { resultsCount: results.length, userId: user.id });

    return new Response(
      JSON.stringify({
        success: true,
        results: results,
        analysisType: analysisType,
        processedCount: texts.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-sentiment function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Erro interno do servidor', 
        message: error instanceof Error ? error.message : 'Erro desconhecido' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
