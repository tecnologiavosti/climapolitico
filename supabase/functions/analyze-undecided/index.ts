import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to parse JWT payload (without validation)
function parseJWTPayload(token: string): any {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

// Normalize region name to standard format
function normalizeRegion(region: string | null): string {
  if (!region) return 'NACIONAL';
  const normalized = region.trim().toUpperCase();
  
  const regionMap: Record<string, string> = {
    'BRASIL': 'NACIONAL', 'BR': 'NACIONAL', 'NACIONAL': 'NACIONAL',
    'DF': 'DISTRITO FEDERAL', 'DISTRITO FEDERAL': 'DISTRITO FEDERAL',
    'SP': 'SÃO PAULO', 'SAO PAULO': 'SÃO PAULO', 'SÃO PAULO': 'SÃO PAULO',
    'RJ': 'RIO DE JANEIRO', 'RIO DE JANEIRO': 'RIO DE JANEIRO',
    'MG': 'MINAS GERAIS', 'MINAS GERAIS': 'MINAS GERAIS',
    'BA': 'BAHIA', 'BAHIA': 'BAHIA',
    'PR': 'PARANÁ', 'PARANA': 'PARANÁ', 'PARANÁ': 'PARANÁ',
    'RS': 'RIO GRANDE DO SUL', 'RIO GRANDE DO SUL': 'RIO GRANDE DO SUL',
    'PE': 'PERNAMBUCO', 'PERNAMBUCO': 'PERNAMBUCO',
    'CE': 'CEARÁ', 'CEARA': 'CEARÁ', 'CEARÁ': 'CEARÁ',
    'PA': 'PARÁ', 'PARA': 'PARÁ', 'PARÁ': 'PARÁ',
    'SC': 'SANTA CATARINA', 'SANTA CATARINA': 'SANTA CATARINA',
    'GO': 'GOIÁS', 'GOIAS': 'GOIÁS', 'GOIÁS': 'GOIÁS',
    'MA': 'MARANHÃO', 'MARANHAO': 'MARANHÃO', 'MARANHÃO': 'MARANHÃO',
    'ES': 'ESPÍRITO SANTO', 'ESPIRITO SANTO': 'ESPÍRITO SANTO', 'ESPÍRITO SANTO': 'ESPÍRITO SANTO',
    'PB': 'PARAÍBA', 'PARAIBA': 'PARAÍBA', 'PARAÍBA': 'PARAÍBA',
    'RN': 'RIO GRANDE DO NORTE', 'RIO GRANDE DO NORTE': 'RIO GRANDE DO NORTE',
    'AL': 'ALAGOAS', 'ALAGOAS': 'ALAGOAS',
    'PI': 'PIAUÍ', 'PIAUI': 'PIAUÍ', 'PIAUÍ': 'PIAUÍ',
    'MT': 'MATO GROSSO', 'MATO GROSSO': 'MATO GROSSO',
    'MS': 'MATO GROSSO DO SUL', 'MATO GROSSO DO SUL': 'MATO GROSSO DO SUL',
    'SE': 'SERGIPE', 'SERGIPE': 'SERGIPE',
    'RO': 'RONDÔNIA', 'RONDONIA': 'RONDÔNIA', 'RONDÔNIA': 'RONDÔNIA',
    'TO': 'TOCANTINS', 'TOCANTINS': 'TOCANTINS',
    'AC': 'ACRE', 'ACRE': 'ACRE',
    'AM': 'AMAZONAS', 'AMAZONAS': 'AMAZONAS',
    'RR': 'RORAIMA', 'RORAIMA': 'RORAIMA',
    'AP': 'AMAPÁ', 'AMAPA': 'AMAPÁ', 'AMAPÁ': 'AMAPÁ'
  };
  
  return regionMap[normalized] || normalized;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    // Create admin client for validation
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    
    // Extract and validate JWT
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    
    if (userError || !user) {
      const jwtPayload = parseJWTPayload(token);
      
      console.error('❌ Authentication failed:', {
        error: userError?.message || 'Auth session missing!',
        errorName: userError?.name,
        errorStatus: userError?.status,
        hasAuthHeader: true,
        authHeaderPreview: authHeader.substring(0, 20) + '...',
        jwtPayload: jwtPayload ? {
          exp: jwtPayload.exp,
          sub: jwtPayload.sub,
          iat: jwtPayload.iat
        } : null
      });
      
      return new Response(
        JSON.stringify({ 
          error: 'Unauthorized - Invalid or expired session',
          details: userError?.message || 'JWT token validation failed'
        }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    // Create user-scoped client for database operations
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);

    const { candidate_id, period_start, period_end } = await req.json();

    if (!candidate_id) {
      throw new Error('candidate_id is required');
    }

    console.log(`Analyzing undecided voters for candidate ${candidate_id}, user ${user.id}`);

    // Fetch candidate info
    const { data: candidate, error: candidateError } = await supabaseClient
      .from('candidates')
      .select('full_name, region, party')
      .eq('id', candidate_id)
      .single();

    if (candidateError) throw candidateError;

    // Normalize and validate candidate region
    const candidateRegion = normalizeRegion(candidate.region);
    const isNationalCandidate = candidateRegion === 'NACIONAL';
    console.log(`🔍 Analyzing undecided voters for ${candidate.full_name} in region: ${candidateRegion} (National: ${isNationalCandidate})`);

    // Fetch analyses for the candidate in the period
    let query = supabaseClient
      .from('candidate_analyses')
      .select('*')
      .eq('candidate_id', candidate_id)
      .eq('user_id', user.id);

    // CRITICAL: Filter by geographic scope for regional candidates
    if (!isNationalCandidate) {
      const geoScope = `regional_${candidateRegion.toLowerCase().replace(/ /g, '_')}`;
      query = query.eq('geographic_scope', geoScope);
      console.log(`📍 Filtering analyses by geographic scope: ${geoScope}`);
    }

    if (period_start) {
      query = query.gte('created_at', period_start);
    }
    if (period_end) {
      query = query.lte('created_at', period_end);
    }

    const { data: analyses, error: analysesError } = await query;
    if (analysesError) throw analysesError;

    if (!analyses || analyses.length === 0) {
      const regionMsg = isNationalCandidate 
        ? 'em todo o Brasil' 
        : `na região ${candidateRegion}`;
      throw new Error(
        `Nenhuma análise encontrada para este candidato ${regionMsg} no período selecionado. ` +
        `Certifique-se de que as análises foram feitas com dados da região correta.`
      );
    }
    
    console.log(`✓ Found ${analyses.length} analyses for region ${candidateRegion}`);

    // Calculate metrics
    const neutralAnalyses = analyses.filter(a => 
      a.sentiment_score >= 40 && a.sentiment_score <= 60
    );
    const neutralCount = neutralAnalyses.reduce((sum, a) => sum + (a.mentions_count || 0), 0);
    const totalCount = analyses.reduce((sum, a) => sum + (a.mentions_count || 0), 0);
    const undecidedPercentage = totalCount > 0 ? (neutralCount / totalCount) * 100 : 0;

    // Aggregate keywords from neutral analyses
    const allKeywords = neutralAnalyses
      .flatMap(a => a.keywords || [])
      .filter((k): k is string => typeof k === 'string');
    
    // Get unique keywords
    const keywordFrequency = allKeywords.reduce((acc, keyword) => {
      acc[keyword] = (acc[keyword] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const topKeywords = Object.entries(keywordFrequency)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([keyword]) => keyword);

    // Fetch analysis sources for social media breakdown - filter by region
    const analysisIds = analyses.map(a => a.id);
    let sourcesQuery = supabaseClient
      .from('analysis_sources')
      .select('*')
      .in('analysis_id', analysisIds);
    
    // CRITICAL: Filter sources by candidate's region for regional candidates
    if (!isNationalCandidate) {
      sourcesQuery = sourcesQuery.or(
        `inferred_region.eq.${candidateRegion},profile_location_state.eq.${candidateRegion}`
      );
      console.log(`📍 Filtering sources by region: ${candidateRegion}`);
    }

    const { data: sources, error: sourcesError } = await sourcesQuery;

    if (sourcesError) {
      console.error('Error fetching analysis sources:', sourcesError);
    }
    
    if (!sources || sources.length === 0) {
      console.warn(`⚠️ No sources found for region ${candidateRegion}`);
    } else {
      console.log(`✓ Found ${sources.length} valid sources for region ${candidateRegion}`);
    }

    // Aggregate social media breakdown
    const socialMediaMap: Record<string, { network: string; posts: number; comments: number; interactions: number; profiles: number }> = {};
    
    if (sources) {
      sources.forEach(source => {
        const network = source.social_network || 'Outro';
        if (!socialMediaMap[network]) {
          socialMediaMap[network] = {
            network,
            posts: 0,
            comments: 0,
            interactions: 0,
            profiles: 0
          };
        }
        socialMediaMap[network].posts += source.posts_collected || 0;
        socialMediaMap[network].comments += source.comments_collected || 0;
        socialMediaMap[network].interactions += source.interactions_count || 0;
        socialMediaMap[network].profiles += 1;
      });
    }

    const socialMediaBreakdown = {
      sources: Object.values(socialMediaMap),
      total_posts: Object.values(socialMediaMap).reduce((sum, s) => sum + s.posts, 0),
      total_comments: Object.values(socialMediaMap).reduce((sum, s) => sum + s.comments, 0),
      total_interactions: Object.values(socialMediaMap).reduce((sum, s) => sum + s.interactions, 0),
      total_profiles: Object.values(socialMediaMap).reduce((sum, s) => sum + s.profiles, 0)
    };

    // Create temporal evolution data
    const temporalEvolution = analyses
      .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())
      .map(analysis => {
        const sentimentScore = analysis.sentiment_score || 50;
        const isNeutral = sentimentScore >= 40 && sentimentScore <= 60;
        const neutralCount = isNeutral ? (analysis.mentions_count || 0) : 0;
        const totalCount = analysis.mentions_count || 1;
        const undecidedPercentage = (neutralCount / totalCount) * 100;
        
        return {
          date: analysis.created_at?.split('T')[0] || '',
          undecided_percentage: undecidedPercentage,
          neutral_count: neutralCount,
          total_count: totalCount,
          sentiment_score: sentimentScore
        };
      });

    // Fetch all candidates for comparison
    const { data: allCandidates, error: allCandidatesError } = await supabaseClient
      .from('candidates')
      .select('id, full_name')
      .eq('user_id', user.id);

    if (allCandidatesError) {
      console.error('Error fetching all candidates:', allCandidatesError);
    }

    // Fetch analyses for all candidates in the same period
    let allAnalysesQuery = supabaseClient
      .from('candidate_analyses')
      .select('candidate_id, sentiment_score, mentions_count')
      .eq('user_id', user.id);

    if (period_start) {
      allAnalysesQuery = allAnalysesQuery.gte('created_at', period_start);
    }
    if (period_end) {
      allAnalysesQuery = allAnalysesQuery.lte('created_at', period_end);
    }

    const { data: allAnalyses, error: allAnalysesError } = await allAnalysesQuery;

    if (allAnalysesError) {
      console.error('Error fetching all analyses:', allAnalysesError);
    }

    // Aggregate by candidate
    const candidateMap: Record<string, { positive: number; negative: number; neutral: number; total: number }> = {};
    
    if (allAnalyses && allCandidates) {
      allAnalyses.forEach(analysis => {
        const candidateId = analysis.candidate_id;
        if (!candidateMap[candidateId]) {
          candidateMap[candidateId] = { positive: 0, negative: 0, neutral: 0, total: 0 };
        }
        
        const score = analysis.sentiment_score || 50;
        const mentions = analysis.mentions_count || 0;
        
        if (score > 60) {
          candidateMap[candidateId].positive += mentions;
        } else if (score < 40) {
          candidateMap[candidateId].negative += mentions;
        } else {
          candidateMap[candidateId].neutral += mentions;
        }
        candidateMap[candidateId].total += mentions;
      });
    }

    const candidatesComparison = allCandidates?.map(candidate => {
      const data = candidateMap[candidate.id] || { positive: 0, negative: 0, neutral: 0, total: 1 };
      return {
        candidate_id: candidate.id,
        candidate_name: candidate.full_name,
        positive_percentage: (data.positive / data.total) * 100,
        negative_percentage: (data.negative / data.total) * 100,
        neutral_percentage: (data.neutral / data.total) * 100,
        total_mentions: data.total
      };
    }) || [];

    // Prepare data summary for AI analysis with geographic context
    const dataSummary = {
      candidate: {
        name: candidate.full_name,
        party: candidate.party,
        region: candidateRegion,
        electoralScope: isNationalCandidate ? 'Nacional (Presidência)' : `Regional - ${candidateRegion}`,
      },
      geographicContext: {
        scope: isNationalCandidate ? 'nacional' : 'regional',
        region: candidateRegion,
        validation: isNationalCandidate 
          ? 'Análise nacional - dados de todo o Brasil' 
          : `Análise regional - dados exclusivos de ${candidateRegion}`,
      },
      total_analyses: analyses.length,
      neutral_analyses_count: neutralAnalyses.length,
      undecided_percentage: undecidedPercentage.toFixed(2),
      total_mentions: totalCount,
      neutral_mentions: neutralCount,
      top_keywords: topKeywords,
      sentiment_distribution: {
        positive: analyses.filter(a => a.sentiment_score > 60).length,
        neutral: neutralAnalyses.length,
        negative: analyses.filter(a => a.sentiment_score < 40).length
      },
      social_media_breakdown: socialMediaBreakdown,
      temporal_evolution: temporalEvolution,
      candidates_comparison: candidatesComparison
    };

    console.log('Data summary for AI:', JSON.stringify(dataSummary, null, 2));

    // Call Lovable AI
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiPrompt = `Você é um especialista em análise de comportamento eleitoral.

**CONTEXTO GEOGRÁFICO CRÍTICO:**
O candidato ${candidate.full_name} concorre em: ${candidateRegion}
${isNationalCandidate 
  ? '🇧🇷 Esta é uma candidatura NACIONAL (Presidente). A análise considera dados de TODO O BRASIL.' 
  : `📍 Esta é uma candidatura REGIONAL (${candidateRegion}). A análise considera EXCLUSIVAMENTE dados da região ${candidateRegion}.`}

Analise os seguintes dados sobre eleitores indecisos/neutros para o candidato:

Dados:
${JSON.stringify(dataSummary, null, 2)}

Forneça uma análise estruturada em português brasileiro identificando:

1. PADRÕES COMPORTAMENTAIS (behavioral_patterns): Liste 3-5 padrões comportamentais observados nos eleitores indecisos. Cada padrão deve ter:
   - pattern: descrição do padrão
   - frequency: frequência observada (baixa/média/alta)
   - impact: impacto potencial (baixo/médio/alto)

2. GATILHOS DE DECISÃO (decision_triggers): Identifique 3-5 fatores que podem influenciar a decisão desses eleitores:
   - trigger: o gatilho/fator
   - effectiveness: efetividade estimada (baixa/média/alta)
   - timing: momento ideal para usar (curto prazo/médio prazo/longo prazo)

3. PERFIL DEMOGRÁFICO (demographic_profile): Baseado nos dados, infira características demográficas:
   - age_groups: faixas etárias mais presentes (array)
   - regions: regiões de maior concentração (array)
   - concerns: principais preocupações (array)

4. TÓPICOS-CHAVE (key_topics): Liste 5-8 tópicos que geram mais indecisão

5. ESTRATÉGIAS DE PERSUASÃO (persuasion_strategies): Sugira 4-6 estratégias práticas:
   - strategy: descrição da estratégia
   - target: público-alvo específico
   - channel: canal recomendado (redes sociais/TV/eventos/etc)
   - priority: prioridade (alta/média/baixa)

6. SCORE DE FLUTUAÇÃO (sentiment_fluctuation_score): Dê um score de 0-100 indicando o quão volátil é o sentimento desse grupo (0=muito estável, 100=extremamente volátil)

7. CONFIDENCE SCORE: Dê um score de 0-100 sobre sua confiança nesta análise baseado na quantidade e qualidade dos dados.

Retorne APENAS um JSON válido (sem markdown, sem explicações extras) com esta estrutura:
{
  "behavioral_patterns": [{"pattern": "...", "frequency": "...", "impact": "..."}],
  "decision_triggers": [{"trigger": "...", "effectiveness": "...", "timing": "..."}],
  "demographic_profile": {"age_groups": [], "regions": [], "concerns": []},
  "key_topics": [],
  "persuasion_strategies": [{"strategy": "...", "target": "...", "channel": "...", "priority": "..."}],
  "sentiment_fluctuation_score": 0,
  "confidence_score": 0
}`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'Você é um especialista em análise política e comportamento eleitoral. Retorne sempre JSON válido, sem markdown.' 
          },
          { role: 'user', content: aiPrompt }
        ],
        temperature: 0.7,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Lovable AI error:', aiResponse.status, errorText);
      throw new Error(`Lovable AI error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    let aiResult = aiData.choices[0].message.content;

    // Remove markdown code blocks if present
    aiResult = aiResult.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    console.log('AI raw result:', aiResult);

    const parsedResult = JSON.parse(aiResult);

    // Insert analysis into database
    const { data: analysisRecord, error: insertError } = await supabaseClient
      .from('undecided_analyses')
      .insert({
        user_id: user.id,
        candidate_id,
        undecided_percentage: parseFloat(undecidedPercentage.toFixed(2)),
        neutral_profiles_count: neutralCount,
        total_profiles_analyzed: totalCount,
        behavioral_patterns: parsedResult.behavioral_patterns,
        decision_triggers: parsedResult.decision_triggers,
        demographic_profile: parsedResult.demographic_profile,
        key_topics: parsedResult.key_topics,
        persuasion_strategies: parsedResult.persuasion_strategies,
        sentiment_fluctuation_score: parsedResult.sentiment_fluctuation_score,
        ai_model_used: 'google/gemini-2.5-flash',
        confidence_score: parsedResult.confidence_score,
        analysis_period_start: period_start || null,
        analysis_period_end: period_end || null,
        social_media_breakdown: socialMediaBreakdown,
        temporal_evolution: temporalEvolution,
        candidates_comparison: candidatesComparison,
      })
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      throw insertError;
    }

    console.log('Analysis completed successfully');

    return new Response(
      JSON.stringify({ 
        success: true, 
        analysis: analysisRecord,
        message: 'Análise de eleitores indecisos concluída com sucesso'
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in analyze-undecided function:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? error.toString() : String(error);
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: errorDetails
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});