import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RegionData {
  region: string;
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  engagement: number;
  acceptance: number;
  sentiment_class: "positive" | "negative" | "mixed" | "insufficient";
  topWords: string[];
  topComments: { text: string; sentiment: string; network: string; likes: number; date: string }[];
}

export interface StateData {
  uf: string;
  name: string;
  region: string;
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  engagement: number;
  acceptance: number;
  sentiment_class: "very_positive" | "positive" | "mixed" | "negative" | "very_negative" | "insufficient";
  topWords: string[];
}

export interface EventRepercussionData {
  event: { id: string; name: string; type: string; date: string; description?: string; keywords?: string[] };
  totals: { mentions: number; acceptance: number; positive: number; negative: number; unmapped: number; coverage: number; usedSemanticFallback?: boolean };
  regions: Record<string, RegionData>;
  states: Record<string, StateData>;
  timeline: { date: string; total: number; pos: number; neg: number; neu: number; phase: "antes" | "durante" | "depois" }[];
  insights: {
    mostEngaged: { region: string; value: number } | null;
    mostCritical: { region: string; acceptance: number } | null;
    mostFavorable: { region: string; acceptance: number } | null;
    topGrowingTheme: string | null;
    aiSummary: string;
    aiAvailable: boolean;
  };
  cached?: boolean;
}

export function useEventRepercussion(eventId: string | null, rangeDays = 7) {
  return useQuery({
    queryKey: ["event-repercussion", eventId, rangeDays],
    queryFn: async (): Promise<EventRepercussionData> => {
      const { data, error } = await supabase.functions.invoke("analyze-event-regional", {
        body: { eventId, rangeDays },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as EventRepercussionData;
    },
    enabled: !!eventId,
    staleTime: 5 * 60_000,
  });
}
