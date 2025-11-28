import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface ModelResult {
  sentiment?: string;
  ideology?: string;
  sentimentScore?: number;
}

interface AgreementMetrics {
  sentimentAgreement: number;
  ideologyAgreement: number;
  totalAnalyses: number;
  divergences: Array<{
    analysisId: string;
    candidateName: string;
    date: string;
    sentimentDivergence: boolean;
    ideologyDivergence: boolean;
    models: {
      geminiFlash?: ModelResult;
      geminiPro?: ModelResult;
      gpt5Mini?: ModelResult;
    };
  }>;
  sentimentDistribution: Record<string, number>;
  ideologyDistribution: Record<string, number>;
}

export function useModelAgreement(limit: number = 50) {
  return useQuery({
    queryKey: ["model-agreement", limit],
    queryFn: async (): Promise<AgreementMetrics> => {
      const { data: analyses, error } = await supabase
        .from("candidate_analyses")
        .select(`
          id,
          created_at,
          sentiment_label,
          ideology_label,
          gemini_flash_result,
          gemini_pro_result,
          gpt5_mini_result,
          candidate_id,
          candidates!inner(full_name)
        `)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      let sentimentAgreementCount = 0;
      let ideologyAgreementCount = 0;
      const divergences: AgreementMetrics["divergences"] = [];
      const sentimentDistribution: Record<string, number> = {};
      const ideologyDistribution: Record<string, number> = {};

      analyses?.forEach((analysis: any) => {
        const geminiFlash = analysis.gemini_flash_result as ModelResult;
        const geminiPro = analysis.gemini_pro_result as ModelResult;
        const gpt5Mini = analysis.gpt5_mini_result as ModelResult;

        if (!geminiFlash || !geminiPro || !gpt5Mini) return;

        // Count sentiment agreement (all 3 models agree)
        const sentiments = [
          geminiFlash.sentiment,
          geminiPro.sentiment,
          gpt5Mini.sentiment,
        ].filter(Boolean);

        const sentimentAgree = sentiments.length === 3 && 
          sentiments.every((s) => s === sentiments[0]);

        if (sentimentAgree) sentimentAgreementCount++;

        // Count ideology agreement
        const ideologies = [
          geminiFlash.ideology,
          geminiPro.ideology,
          gpt5Mini.ideology,
        ].filter(Boolean);

        const ideologyAgree = ideologies.length === 3 && 
          ideologies.every((i) => i === ideologies[0]);

        if (ideologyAgree) ideologyAgreementCount++;

        // Track distributions
        sentiments.forEach((s) => {
          if (s) sentimentDistribution[s] = (sentimentDistribution[s] || 0) + 1;
        });

        ideologies.forEach((i) => {
          if (i) ideologyDistribution[i] = (ideologyDistribution[i] || 0) + 1;
        });

        // Identify divergences (disagreement requiring review)
        if (!sentimentAgree || !ideologyAgree) {
          divergences.push({
            analysisId: analysis.id,
            candidateName: analysis.candidates?.full_name || "Desconhecido",
            date: new Date(analysis.created_at).toLocaleDateString("pt-BR"),
            sentimentDivergence: !sentimentAgree,
            ideologyDivergence: !ideologyAgree,
            models: {
              geminiFlash,
              geminiPro,
              gpt5Mini,
            },
          });
        }
      });

      const totalAnalyses = analyses?.length || 0;

      return {
        sentimentAgreement: totalAnalyses > 0 
          ? (sentimentAgreementCount / totalAnalyses) * 100 
          : 0,
        ideologyAgreement: totalAnalyses > 0 
          ? (ideologyAgreementCount / totalAnalyses) * 100 
          : 0,
        totalAnalyses,
        divergences: divergences.slice(0, 10), // Top 10 divergences
        sentimentDistribution,
        ideologyDistribution,
      };
    },
    refetchInterval: 30000, // Refresh every 30s
  });
}
