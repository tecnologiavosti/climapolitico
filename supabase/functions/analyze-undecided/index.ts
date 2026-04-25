import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      console.error('❌ Authentication failed:', userError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { candidate_id, period_start, period_end } = await req.json();

    if (!candidate_id) {
      throw new Error('candidate_id is required');
    }

    console.log(`Analyzing undecided voters for candidate ${candidate_id}, user ${user.id}`);

    // Fetch candidate info
    const { data: candidate, error: candidateError } = await supabaseAdmin
      .from('candidates')
      .select('full_name, region, party')
      .eq('id', candidate_id)
      .single();

    if (candidateError) throw candidateError;

    console.log(`🔍 Analyzing undecided voters for ${candidate.full_name}`);

    // Build query for social_interactions - the NEW single source of truth
    let query = supabaseAdmin
      .from('social_interactions')
      .select('*')
      .eq('candidate_id', candidate_id)
      .eq('user_id', user.id);

    if (period_start) {
      query = query.gte('collected_at', period_start);
    }
    if (period_end) {
      query = query.lte('collected_at', period_end);
    }

    const { data: interactions, error: interactionsError } = await query;
    if (interactionsError) throw interactionsError;

    if (!interactions || interactions.length === 0) {
      throw new Error(
        `Nenhuma interação encontrada para este candidato no período selecionado. ` +
        `Execute uma coleta de dados (YouTube, etc.) antes de analisar o público indeciso.`
      );
    }
    
    console.log(`✓ Found ${interactions.length} interactions for analysis`);

    // Classify sentiment from interactions
    // NOTE: In our dataset, sentiment_score is 0..1 (neutral ~= 0.5) and sentiment_label is PT-BR.
    const classifyMention = (sentimentLabel: string | null, score: number | null) => {
      const label = (sentimentLabel || '').trim().toLowerCase();
      if (label === 'positivo') return 'positive';
      if (label === 'negativo') return 'negative';
      if (label === 'neutro') return 'neutral';

      if (score === null) return 'neutral';
      if (score >= 0.6) return 'positive';
      if (score <= 0.4) return 'negative';
      return 'neutral';
    };

    const positiveInteractions = interactions.filter(i => classifyMention(i.sentiment_label, i.sentiment_score) === 'positive');
    const negativeInteractions = interactions.filter(i => classifyMention(i.sentiment_label, i.sentiment_score) === 'negative');
    const neutralInteractions = interactions.filter(i => classifyMention(i.sentiment_label, i.sentiment_score) === 'neutral');

    const totalCount = interactions.length;
    const neutralCount = neutralInteractions.length;
    const undecidedPercentage = totalCount > 0 ? (neutralCount / totalCount) * 100 : 0;

    // Extract keywords from neutral/undecided comments
    const extractKeywords = (text: string): string[] => {
      if (!text) return [];
      const stopWords = ['de', 'da', 'do', 'que', 'e', 'em', 'um', 'uma', 'para', 'com', 'não', 'por', 'se', 'na', 'no', 'os', 'as', 'é', 'o', 'a', 'mas'];
      return text
        .toLowerCase()
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.includes(word))
        .slice(0, 5);
    };

    const allKeywords = neutralInteractions
      .flatMap(i => extractKeywords(i.comment_text || ''))
      .filter(Boolean);

    const keywordFrequency = allKeywords.reduce((acc, keyword) => {
      acc[keyword] = (acc[keyword] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topKeywords = Object.entries(keywordFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 15)
      .map(([keyword]) => keyword);

    // Social media breakdown
    const socialMediaMap: Record<string, { network: string; mentions: number; engagement: number; neutralCount: number }> = {};
    
    interactions.forEach(interaction => {
      const network = interaction.social_network || 'Outro';
      if (!socialMediaMap[network]) {
        socialMediaMap[network] = { network, mentions: 0, engagement: 0, neutralCount: 0 };
      }
      socialMediaMap[network].mentions += 1;
      socialMediaMap[network].engagement += (interaction.likes_count || 0) + (interaction.replies_count || 0) + (interaction.shares_count || 0);
      if (classifyMention(interaction.sentiment_label, interaction.sentiment_score) === 'neutral') {
        socialMediaMap[network].neutralCount += 1;
      }
    });

    const socialMediaBreakdown = {
      sources: Object.values(socialMediaMap),
      total_mentions: totalCount,
      total_engagement: Object.values(socialMediaMap).reduce((sum, s) => sum + s.engagement, 0),
      total_neutral: neutralCount
    };

    // Temporal evolution - group by date
    const dateMap = new Map<string, { date: string; total: number; neutral: number; positive: number; negative: number }>();
    
    interactions.forEach(interaction => {
      const date = (interaction.collected_at || interaction.created_at)?.split('T')[0] || '';
      if (!date) return;
      
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, total: 0, neutral: 0, positive: 0, negative: 0 });
      }
      
      const entry = dateMap.get(date)!;
      entry.total += 1;
      
      const sentiment = classifyMention(interaction.sentiment_label, interaction.sentiment_score);
      if (sentiment === 'neutral') entry.neutral += 1;
      else if (sentiment === 'positive') entry.positive += 1;
      else entry.negative += 1;
    });

    const temporalEvolution = Array.from(dateMap.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        undecided_percentage: d.total > 0 ? (d.neutral / d.total) * 100 : 0
      }));

    // Get unique authors for demographic inference
    const uniqueAuthors = [...new Set(interactions.map(i => i.comment_author).filter(Boolean))];

    // Prepare data summary for AI
    const dataSummary = {
      candidate: {
        name: candidate.full_name,
        party: candidate.party,
        region: candidate.region
      },
      total_interactions: totalCount,
      sentiment_distribution: {
        positive: positiveInteractions.length,
        neutral: neutralCount,
        negative: negativeInteractions.length,
        positive_pct: ((positiveInteractions.length / totalCount) * 100).toFixed(1),
        neutral_pct: ((neutralCount / totalCount) * 100).toFixed(1),
        negative_pct: ((negativeInteractions.length / totalCount) * 100).toFixed(1)
      },
      undecided_percentage: undecidedPercentage.toFixed(2),
      unique_authors: uniqueAuthors.length,
      top_keywords: topKeywords,
      social_media_breakdown: socialMediaBreakdown,
      temporal_evolution: temporalEvolution.slice(-30), // Last 30 days
      sample_neutral_comments: neutralInteractions.slice(0, 10).map(i => i.comment_text?.substring(0, 200))
    };

    console.log('📊 Data summary prepared, calling AI for analysis...');

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiPrompt = `Você é um especialista em análise de comportamento eleitoral.

Analise os seguintes dados sobre eleitores indecisos/neutros para o candidato ${candidate.full_name}:

Dados:
${JSON.stringify(dataSummary, null, 2)}

Forneça uma análise estruturada em português brasileiro:

1. PADRÕES COMPORTAMENTAIS (behavioral_patterns): Liste 3-5 padrões comportamentais. Cada padrão:
   - pattern: descrição do padrão
   - frequency: frequência (baixa/média/alta)
   - impact: impacto potencial (baixo/médio/alto)

2. GATILHOS DE DECISÃO (decision_triggers): 3-5 fatores que influenciam a decisão:
   - trigger: o gatilho/fator
   - effectiveness: efetividade (baixa/média/alta)
   - timing: momento ideal (curto prazo/médio prazo/longo prazo)

3. PERFIL DEMOGRÁFICO (demographic_profile): Infira características:
   - age_groups: faixas etárias mais presentes (array)
   - regions: regiões de maior concentração (array)
   - concerns: principais preocupações (array)

4. TÓPICOS-CHAVE (key_topics): 5-8 tópicos que geram indecisão

5. ESTRATÉGIAS DE PERSUASÃO (persuasion_strategies): 4-6 estratégias:
   - strategy: descrição
   - target: público-alvo
   - channel: canal recomendado
   - priority: prioridade (alta/média/baixa)

6. SCORE DE FLUTUAÇÃO (sentiment_fluctuation_score): 0-100 indicando volatilidade

7. CONFIDENCE SCORE: 0-100 sobre confiança na análise

Retorne APENAS JSON válido (sem markdown):
{
  "behavioral_patterns": [{"pattern": "...", "frequency": "...", "impact": "..."}],
  "decision_triggers": [{"trigger": "...", "effectiveness": "...", "timing": "..."}],
  "demographic_profile": {"age_groups": [], "regions": [], "concerns": []},
  "key_topics": [],
  "persuasion_strategies": [{"strategy": "...", "target": "...", "channel": "...", "priority": "..."}],
  "sentiment_fluctuation_score": 0,
  "confidence_score": 0
}`;

    console.log('🤖 Calling AI for undecided voter analysis...');
    
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-5-mini',
        messages: [
          { role: 'system', content: 'Você é um especialista em análise política. Retorne sempre JSON válido, sem markdown.' },
          { role: 'user', content: aiPrompt }
        ],
        // OpenAI-compatible gateway: use max_completion_tokens (max_tokens is rejected for newer models)
        max_completion_tokens: 1200,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', errorText);
      return new Response(
        JSON.stringify({
          error: `AI API error: ${aiResponse.status}`,
          details: errorText,
        }),
        {
          status: aiResponse.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.choices?.[0]?.message?.content || '{}';
    
    let aiAnalysis;
    try {
      const cleanContent = aiContent.replace(/```json\n?|\n?```/g, '').trim();
      aiAnalysis = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      aiAnalysis = {
        behavioral_patterns: [],
        decision_triggers: [],
        demographic_profile: { age_groups: [], regions: [], concerns: [] },
        key_topics: topKeywords,
        persuasion_strategies: [],
        sentiment_fluctuation_score: 50,
        confidence_score: 30
      };
    }

    // Save analysis to database
    const analysisRecord = {
      user_id: user.id,
      candidate_id,
      undecided_percentage: undecidedPercentage,
      neutral_profiles_count: neutralCount,
      total_profiles_analyzed: totalCount,
      behavioral_patterns: aiAnalysis.behavioral_patterns || [],
      decision_triggers: aiAnalysis.decision_triggers || [],
      demographic_profile: aiAnalysis.demographic_profile || {},
      persuasion_strategies: aiAnalysis.persuasion_strategies || [],
      sentiment_fluctuation_score: aiAnalysis.sentiment_fluctuation_score || 50,
      confidence_score: aiAnalysis.confidence_score || 50,
      key_topics: aiAnalysis.key_topics || topKeywords,
      ai_model_used: 'openai/gpt-5-mini',
      social_media_breakdown: socialMediaBreakdown,
      temporal_evolution: temporalEvolution,
      candidates_comparison: [],
      analysis_period_start: period_start || null,
      analysis_period_end: period_end || null
    };

    const { data: savedAnalysis, error: saveError } = await supabaseAdmin
      .from('undecided_analyses')
      .insert(analysisRecord)
      .select()
      .single();

    if (saveError) {
      console.error('Error saving analysis:', saveError);
    } else {
      console.log('✓ Analysis saved with ID:', savedAnalysis.id);
    }

    const response = {
      success: true,
      analysis: {
        id: savedAnalysis?.id,
        candidate_name: candidate.full_name,
        ...analysisRecord
      }
    };

    return new Response(
      JSON.stringify(response),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-undecided function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        details: String(error)
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
