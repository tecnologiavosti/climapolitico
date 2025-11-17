import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { speechText, speechTitle, candidateId, speechDate, speechType } = await req.json();

    if (!speechText || !speechTitle) {
      throw new Error('speechText and speechTitle are required');
    }

    console.log('Starting speech analysis for user:', user.id);

    // Get candidate info if provided
    let candidate = null;
    if (candidateId) {
      const { data: candidateData } = await supabase
        .from('candidates')
        .select('full_name, region, party')
        .eq('id', candidateId)
        .maybeSingle();
      candidate = candidateData;
    }

    // Construct AI analysis prompt
    const analysisPrompt = `
Você é um especialista em comunicação política e análise de discurso. 
Analise o seguinte trecho de fala política e identifique:

FALA A SER ANALISADA:
"${speechText}"

${candidate ? `
CONTEXTO DO CANDIDATO:
- Nome: ${candidate.full_name}
- Região: ${candidate.region}
- Partido: ${candidate.party}
` : ''}

TAREFAS:

1. GATILHOS CRÍTICOS:
   - Identifique palavras ou frases que podem gerar percepção negativa
   - Para cada gatilho, indique:
     * A palavra/frase exata
     * Posição aproximada no texto (início, meio, fim)
     * Severidade (1-10)
     * Por que é problemático

2. TRECHOS PROBLEMÁTICOS:
   - Identifique segmentos maiores (frases ou parágrafos) com impacto negativo
   - Para cada trecho:
     * Cite o texto literal
     * Explique o problema
     * Qual sentimento negativo pode despertar (raiva, desconfiança, medo, etc.)

3. ANÁLISE PSICOLÓGICA:
   - Explique em detalhes o impacto psicológico no eleitorado
   - Quais gatilhos emocionais foram ativados?
   - Por que isso pode afastar eleitores?

4. PERFIL DE ELEITORES AFETADOS:
   - Quais grupos demográficos serão mais impactados negativamente?
   - Exemplos: jovens, idosos, classe média, trabalhadores, empresários, etc.

5. ANÁLISE EMOCIONAL (0-100 para cada):
   - Raiva (anger)
   - Medo (fear)
   - Desconfiança (distrust)
   - Esperança (hope)
   - Alegria (joy)
   - Tristeza (sadness)

6. NÍVEL DE RISCO GERAL (1-10):
   - Avalie o quão prejudicial essa fala pode ser para a campanha

7. AÇÕES RECOMENDADAS (2-3 ações práticas):
   - Ações imediatas para mitigar o dano
   - Seja específico e prático

8. SUGESTÕES DE COMUNICAÇÃO:
   - Como o candidato deve se comunicar sobre esse tema daqui pra frente
   - Frases alternativas ou abordagens sugeridas

FORMATO DE RESPOSTA (JSON):
{
  "trigger_words": [
    {"word": "exemplo", "position": "início", "severity": 8, "reason": "motivo"}
  ],
  "problematic_segments": [
    {"text": "trecho literal", "issue": "problema", "emotion": "raiva"}
  ],
  "psychological_impact": "explicação detalhada...",
  "affected_voter_profiles": ["jovens", "classe-média"],
  "emotional_analysis": {
    "anger": 70,
    "fear": 30,
    "distrust": 60,
    "hope": 10,
    "joy": 5,
    "sadness": 20
  },
  "risk_level": 8,
  "recommended_actions": [
    "Ação 1 específica",
    "Ação 2 específica"
  ],
  "communication_suggestions": [
    "Sugestão 1",
    "Sugestão 2"
  ],
  "confidence": 0.85
}

IMPORTANTE: Responda APENAS com o JSON válido, sem texto adicional.
`;

    // Call Lovable AI for deep analysis
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    console.log('Calling Lovable AI for analysis...');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-pro',
        messages: [
          { role: 'user', content: analysisPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        throw new Error('Limite de requisições excedido. Tente novamente em alguns instantes.');
      }
      if (aiResponse.status === 402) {
        throw new Error('Créditos esgotados. Por favor, adicione créditos ao seu workspace Lovable.');
      }
      
      throw new Error('Erro ao analisar fala com IA');
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices[0]?.message?.content;

    if (!aiContent) {
      throw new Error('No response from AI');
    }

    // Parse AI response
    let analysisResult;
    try {
      // Try to extract JSON from response
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in AI response');
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      throw new Error('Erro ao processar resposta da IA');
    }

    // Calculate negative perception score (0-10)
    const negativePerceptionScore = (
      (analysisResult.emotional_analysis.anger || 0) * 0.4 +
      (analysisResult.emotional_analysis.fear || 0) * 0.3 +
      (analysisResult.emotional_analysis.distrust || 0) * 0.3
    ) / 10;

    // Insert analysis into database
    const { data: speechAnalysis, error: insertError } = await supabase
      .from('speech_analyses')
      .insert({
        user_id: user.id,
        candidate_id: candidateId || null,
        speech_title: speechTitle,
        speech_text: speechText,
        speech_date: speechDate || null,
        speech_type: speechType || 'texto',
        media_type: 'text',
        transcription_status: 'completed',
        trigger_words: analysisResult.trigger_words || [],
        problematic_segments: analysisResult.problematic_segments || [],
        negative_perception_score: negativePerceptionScore,
        risk_level: analysisResult.risk_level || 5,
        affected_voter_profiles: analysisResult.affected_voter_profiles || [],
        psychological_impact: analysisResult.psychological_impact || '',
        emotional_analysis: analysisResult.emotional_analysis || {},
        recommended_actions: analysisResult.recommended_actions || [],
        communication_suggestions: analysisResult.communication_suggestions || [],
        ai_model_used: 'google/gemini-2.5-pro',
        analysis_confidence: analysisResult.confidence || 0.8,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw new Error('Erro ao salvar análise no banco de dados');
    }

    console.log('Speech analysis completed successfully');

    return new Response(
      JSON.stringify({
        success: true,
        analysis: speechAnalysis,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in analyze-speech function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
