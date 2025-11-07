import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { texts, analysisType = 'sentiment' } = await req.json();
    console.log('Received request:', { textsCount: texts?.length, analysisType });

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'texts array is required and must not be empty' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      console.error('LOVABLE_API_KEY is not configured');
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
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
    
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('AI API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to continue.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'AI service error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('AI response received');
    
    const aiResponse = data.choices?.[0]?.message?.content;
    if (!aiResponse) {
      console.error('No content in AI response');
      return new Response(
        JSON.stringify({ error: 'Invalid AI response' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        JSON.stringify({ error: 'Failed to parse AI response', rawResponse: aiResponse }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Analysis complete:', { resultsCount: results.length });

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
        error: 'Internal server error', 
        message: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
