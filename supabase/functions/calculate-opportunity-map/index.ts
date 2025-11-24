import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StateOpportunityData {
  state: string;
  stateCode: string;
  opportunityScore: number;
  undecidedPercentage: number;
  avgSentiment: number;
  totalMentions: number;
  totalInteractions: number;
  uniqueProfiles: number;
  recommendedActions: string[];
  dataQuality: "high" | "medium" | "low" | "none";
  undecidedIndex: number;
  sentimentIndex: number;
  engagementIndex: number;
}

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

const stateCodeToName: Record<string, string> = Object.entries(stateNameToCode).reduce(
  (acc, [name, code]) => ({ ...acc, [code]: name }),
  {} as Record<string, string>
);

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

    const { candidateId, daysBack = 30 } = await req.json();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Aggregate data by state
    const stateData = new Map<string, {
      mentions: number;
      sentiment: number[];
      undecidedPercentage: number[];
      interactions: number;
      profiles: Set<string>;
    }>();

    // Fetch candidate analyses with region distribution
    let analysesQuery = supabase
      .from("candidate_analyses")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", startDate.toISOString());

    if (candidateId) {
      analysesQuery = analysesQuery.eq("candidate_id", candidateId);
    }

    const { data: analyses, error: analysesError } = await analysesQuery;
    if (analysesError) throw analysesError;

    // Process candidate analyses
    for (const analysis of analyses || []) {
      if (analysis.region_distribution) {
        const regions = analysis.region_distribution as Record<string, number>;
        for (const [stateName, count] of Object.entries(regions)) {
          const stateCode = stateNameToCode[stateName] || stateName;
          if (!stateData.has(stateCode)) {
            stateData.set(stateCode, {
              mentions: 0,
              sentiment: [],
              undecidedPercentage: [],
              interactions: 0,
              profiles: new Set(),
            });
          }
          const data = stateData.get(stateCode)!;
          data.mentions += count || 0;
          if (analysis.sentiment_score !== null) {
            data.sentiment.push(analysis.sentiment_score);
          }
        }
      }
    }

    // Fetch analysis sources with location data
    let sourcesQuery = supabase
      .from("analysis_sources")
      .select("*, candidate_analyses!inner(*)")
      .gte("created_at", startDate.toISOString());

    const { data: sources, error: sourcesError } = await sourcesQuery;
    if (sourcesError) throw sourcesError;

    for (const source of sources || []) {
      const stateName = source.profile_location_state || source.inferred_region;
      if (stateName) {
        const stateCode = stateNameToCode[stateName] || stateName;
        if (!stateData.has(stateCode)) {
          stateData.set(stateCode, {
            mentions: 0,
            sentiment: [],
            undecidedPercentage: [],
            interactions: 0,
            profiles: new Set(),
          });
        }
        const data = stateData.get(stateCode)!;
        data.interactions += source.interactions_count || 0;
        data.profiles.add(source.profile_unique_id);
      }
    }

    // Fetch undecided analyses
    let undecidedQuery = supabase
      .from("undecided_analyses")
      .select("*")
      .eq("user_id", user.id)
      .gte("created_at", startDate.toISOString());

    if (candidateId) {
      undecidedQuery = undecidedQuery.eq("candidate_id", candidateId);
    }

    const { data: undecided, error: undecidedError } = await undecidedQuery;
    if (undecidedError) throw undecidedError;

    // Process undecided analyses
    for (const analysis of undecided || []) {
      if (analysis.demographic_profile) {
        const demo = analysis.demographic_profile as any;
        if (demo.regions) {
          for (const [stateName, percentage] of Object.entries(demo.regions)) {
            const stateCode = stateNameToCode[stateName as string] || stateName;
            if (!stateData.has(stateCode)) {
              stateData.set(stateCode, {
                mentions: 0,
                sentiment: [],
                undecidedPercentage: [],
                interactions: 0,
                profiles: new Set(),
              });
            }
            const data = stateData.get(stateCode)!;
            if (analysis.undecided_percentage) {
              data.undecidedPercentage.push(analysis.undecided_percentage);
            }
          }
        }
      }
    }

    // Calculate max interactions for normalization
    const maxInteractions = Math.max(...Array.from(stateData.values()).map(d => d.interactions), 1);

    // Calculate opportunity scores
    const states: StateOpportunityData[] = [];
    
    for (const [stateCode, data] of stateData.entries()) {
      const avgSentiment = data.sentiment.length > 0
        ? data.sentiment.reduce((a, b) => a + b, 0) / data.sentiment.length
        : 0;
      
      const avgUndecided = data.undecidedPercentage.length > 0
        ? data.undecidedPercentage.reduce((a, b) => a + b, 0) / data.undecidedPercentage.length
        : 0;

      // Calculate indices
      const undecidedIndex = Math.min((avgUndecided / 40) * 100, 100);
      const sentimentIndex = ((avgSentiment + 1) / 2) * 100;
      const engagementIndex = (data.interactions / maxInteractions) * 100;

      // Calculate final score (40% undecided + 30% sentiment + 30% engagement)
      const opportunityScore = Math.round(
        undecidedIndex * 0.4 +
        sentimentIndex * 0.3 +
        engagementIndex * 0.3
      );

      // Determine data quality
      let dataQuality: "high" | "medium" | "low" | "none";
      if (data.mentions === 0 && data.profiles.size === 0) {
        dataQuality = "none";
      } else if (data.mentions > 500 && data.profiles.size > 100) {
        dataQuality = "high";
      } else if (data.mentions > 100 && data.profiles.size > 20) {
        dataQuality = "medium";
      } else {
        dataQuality = "low";
      }

      // Generate AI recommendations for states with sufficient data
      const recommendedActions: string[] = [];
      if (dataQuality !== "none" && opportunityScore >= 40) {
        recommendedActions.push("Aumentar investimento em anúncios digitais regionais");
        recommendedActions.push("Focar em temas de interesse local");
        if (avgUndecided > 25) {
          recommendedActions.push("Intensificar campanha para converter indecisos");
        }
      }

      states.push({
        state: stateCodeToName[stateCode] || stateCode,
        stateCode,
        opportunityScore,
        undecidedPercentage: avgUndecided,
        avgSentiment,
        totalMentions: data.mentions,
        totalInteractions: data.interactions,
        uniqueProfiles: data.profiles.size,
        recommendedActions,
        dataQuality,
        undecidedIndex,
        sentimentIndex,
        engagementIndex,
      });
    }

    // Sort by opportunity score
    states.sort((a, b) => b.opportunityScore - a.opportunityScore);

    return new Response(
      JSON.stringify({
        states,
        topStates: states.slice(0, 5),
        lastUpdated: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in calculate-opportunity-map:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
