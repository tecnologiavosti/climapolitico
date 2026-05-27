import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ExternalSource {
  url: string;
  title: string;
  outlet: string;
  region: string;
  publishedAt: string | null;
  snippet: string;
}

export interface RegionalDistribution {
  Sudeste: number; Nordeste: number; Sul: number;
  "Centro-Oeste": number; Norte: number;
}

export interface ExternalRepercussion {
  totalPublications: number;
  estimatedReach: number;
  majorTopics: string[];
  regionalDistribution: RegionalDistribution;
  positiveSignals: number;
  negativeSignals: number;
  neutralSignals: number;
  narratives: { apoio: string[]; criticas: string[]; debates: string[] };
  sources: ExternalSource[];
  timeline: { date: string; count: number; phase: "antes" | "durante" | "depois" }[];
  summary: string;
  aiAvailable: boolean;
}

export interface InternalReaction {
  mentions: number;
  positive: number;
  negative: number;
  neutral: number;
  engagement: number;
  sample: { text: string; sentiment: string; network: string; likes: number }[];
}

export interface EventRepercussionData {
  event: {
    id: string;
    name: string;
    type: string;
    date: string;
    description?: string | null;
    keywords?: string[];
    location?: string | null;
    importanceScore?: number | null;
  };
  externalRepercussion: ExternalRepercussion;
  internalReaction: InternalReaction;
  confidence: {
    level: "Alta" | "Média" | "Baixa";
    score: number;
    breakdown: { distinctOutlets: number; distinctRegions: number; distinctDays: number };
  };
  debug: {
    publicationsCollected: number;
    publicationsInWindow: number;
    usedForAnalysis: number;
    sourcesByOutlet: Record<string, number>;
    eventWindow: { start: string; end: string };
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
