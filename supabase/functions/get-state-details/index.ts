import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const stateNameToCode: Record<string, string> = {
  "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amapa": "AP", "Amazonas": "AM",
  "Bahia": "BA", "Ceará": "CE", "Ceara": "CE", "Distrito Federal": "DF",
  "Espírito Santo": "ES", "Espirito Santo": "ES", "Goiás": "GO", "Goias": "GO",
  "Maranhão": "MA", "Maranhao": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG", "Pará": "PA", "Para": "PA", "Paraíba": "PB", "Paraiba": "PB",
  "Paraná": "PR", "Parana": "PR", "Pernambuco": "PE", "Piauí": "PI", "Piaui": "PI",
  "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS",
  "Rondônia": "RO", "Rondonia": "RO", "Roraima": "RR", "Santa Catarina": "SC",
  "São Paulo": "SP", "Sao Paulo": "SP", "Sergipe": "SE", "Tocantins": "TO"
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { stateCode, candidateId, daysBack = 30 } = await req.json();
    
    if (!stateCode) {
      throw new Error("stateCode is required");
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Find state name variations
    const stateNames = Object.entries(stateNameToCode)
      .filter(([_, code]) => code === stateCode)
      .map(([name]) => name);

    // Temporal evolution data
    const temporalEvolution: Array<{ date: string; sentiment: number; mentions: number; undecided: number }> = [];
    
    // Get analyses grouped by date
    let analysesQuery = supabase
      .from("candidate_analyses")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true });

    if (candidateId) {
      analysesQuery = analysesQuery.eq("candidate_id", candidateId);
    }

    const { data: analyses, error: analysesError } = await analysesQuery;
    if (analysesError) throw analysesError;

    // Group by date and calculate daily metrics
    const dateMap = new Map<string, { sentiments: number[]; mentions: number }>();
    
    for (const analysis of analyses || []) {
      const date = new Date(analysis.created_at!).toISOString().split('T')[0];
      
      if (analysis.region_distribution) {
        const regions = analysis.region_distribution as Record<string, number>;
        for (const [stateName, count] of Object.entries(regions)) {
          if (stateNames.includes(stateName) || stateName === stateCode) {
            if (!dateMap.has(date)) {
              dateMap.set(date, { sentiments: [], mentions: 0 });
            }
            const data = dateMap.get(date)!;
            data.mentions += count || 0;
            if (analysis.sentiment_score !== null) {
              data.sentiments.push(analysis.sentiment_score);
            }
          }
        }
      }
    }

    // Get undecided data by date
    let undecidedQuery = supabase
      .from("undecided_analyses")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", startDate.toISOString())
      .order("created_at", { ascending: true });

    if (candidateId) {
      undecidedQuery = undecidedQuery.eq("candidate_id", candidateId);
    }

    const { data: undecidedData, error: undecidedError } = await undecidedQuery;
    if (undecidedError) throw undecidedError;

    const undecidedByDate = new Map<string, number[]>();
    for (const analysis of undecidedData || []) {
      const date = new Date(analysis.created_at!).toISOString().split('T')[0];
      if (analysis.demographic_profile) {
        const demo = analysis.demographic_profile as any;
        if (demo.regions) {
          for (const stateName of Object.keys(demo.regions)) {
            if (stateNames.includes(stateName) || stateName === stateCode) {
              if (!undecidedByDate.has(date)) {
                undecidedByDate.set(date, []);
              }
              if (analysis.undecided_percentage) {
                undecidedByDate.get(date)!.push(analysis.undecided_percentage);
              }
            }
          }
        }
      }
    }

    // Build temporal evolution array
    for (const [date, data] of dateMap.entries()) {
      const avgSentiment = data.sentiments.length > 0
        ? data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
        : 0;
      
      const undecidedValues = undecidedByDate.get(date) || [];
      const avgUndecided = undecidedValues.length > 0
        ? undecidedValues.reduce((a, b) => a + b, 0) / undecidedValues.length
        : 0;

      temporalEvolution.push({
        date,
        sentiment: Number(avgSentiment.toFixed(2)),
        mentions: data.mentions,
        undecided: Number(avgUndecided.toFixed(1)),
      });
    }

    // Top keywords for the state
    const keywordMap = new Map<string, { count: number; sentiments: number[] }>();
    
    for (const analysis of analyses || []) {
      if (analysis.region_distribution) {
        const regions = analysis.region_distribution as Record<string, number>;
        const hasState = Object.keys(regions).some(name => 
          stateNames.includes(name) || name === stateCode
        );
        
        if (hasState && analysis.keywords) {
          for (const keyword of analysis.keywords) {
            if (!keywordMap.has(keyword)) {
              keywordMap.set(keyword, { count: 0, sentiments: [] });
            }
            const data = keywordMap.get(keyword)!;
            data.count += 1;
            if (analysis.sentiment_score !== null) {
              data.sentiments.push(analysis.sentiment_score);
            }
          }
        }
      }
    }

    const topKeywords = Array.from(keywordMap.entries())
      .map(([keyword, data]) => ({
        keyword,
        count: data.count,
        sentiment: data.sentiments.length > 0
          ? Number((data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length).toFixed(2))
          : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Social networks breakdown
    const { data: sources, error: sourcesError } = await supabase
      .from("analysis_sources")
      .select("*, candidate_analyses!inner(*)")
      .gte("created_at", startDate.toISOString());

    if (sourcesError) throw sourcesError;

    const networkMap = new Map<string, { mentions: number; engagement: number }>();
    
    for (const source of sources || []) {
      const stateName = source.profile_location_state || source.inferred_region;
      if (stateName && (stateNames.includes(stateName) || stateName === stateCode)) {
        const network = source.social_network;
        if (!networkMap.has(network)) {
          networkMap.set(network, { mentions: 0, engagement: 0 });
        }
        const data = networkMap.get(network)!;
        data.mentions += 1;
        data.engagement += source.interactions_count || 0;
      }
    }

    const socialNetworks = Array.from(networkMap.entries())
      .map(([network, data]) => ({
        network,
        mentions: data.mentions,
        engagement: data.engagement,
      }))
      .sort((a, b) => b.engagement - a.engagement);

    return new Response(
      JSON.stringify({
        temporalEvolution,
        topKeywords,
        socialNetworks,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in get-state-details:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
