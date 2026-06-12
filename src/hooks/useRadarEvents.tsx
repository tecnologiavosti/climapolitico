import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type RadarEventSize = "grande" | "medio" | "pequeno";

export interface RadarEvent {
  id: string;
  title: string;
  summary: string | null;
  category: string | null;
  event_date: string;
  source_count: number;
  social_score: number;
  importance: number;
  status: string | null;
  size: RadarEventSize;
}

export interface RadarEventSource {
  id: string;
  source_name: string;
  source_type: string | null;
  url: string;
  title: string | null;
  published_at: string | null;
  is_institutional: boolean;
  is_major_media: boolean;
}

export function classifyImportance(importance: number): RadarEventSize {
  if (importance > 25) return "grande";
  if (importance >= 12) return "medio";
  return "pequeno";
}

export function useRadarEvents(candidateId: string | null, year: number) {
  return useQuery({
    queryKey: ["radar-events", candidateId, year],
    enabled: !!candidateId,
    staleTime: 60_000,
    queryFn: async (): Promise<RadarEvent[]> => {
      const from = `${year}-01-01`;
      const to = `${year + 1}-01-01`;
      const { data, error } = await supabase
        .from("political_events")
        .select(
          "id, title, event_name, summary, ai_summary_v2, ai_summary, description, category, category_v2, event_type, event_date, source_count, total_sources, publications_count, social_score, importance, importance_score, relevance_score, status"
        )
        .eq("candidate_id", candidateId!)
        .gte("event_date", from)
        .lt("event_date", to)
        .order("event_date", { ascending: false })
        .limit(500);

      if (error) throw error;

      return (data || []).map((r: any) => {
        const importance =
          Number(r.importance) ||
          Number(r.importance_score) ||
          Number(r.relevance_score) ||
          0;
        const source_count =
          Number(r.source_count) ||
          Number(r.total_sources) ||
          Number(r.publications_count) ||
          0;
        return {
          id: r.id,
          title: r.title || r.event_name || "Evento sem título",
          summary: r.summary || r.ai_summary_v2 || r.ai_summary || r.description || null,
          category: r.category || r.category_v2 || r.event_type || null,
          event_date: r.event_date,
          source_count,
          social_score: Number(r.social_score) || 0,
          importance,
          status: r.status,
          size: classifyImportance(importance),
        } as RadarEvent;
      });
    },
  });
}

export function useRadarEventSources(eventId: string | null) {
  return useQuery({
    queryKey: ["radar-event-sources", eventId],
    enabled: !!eventId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RadarEventSource[]> => {
      const { data, error } = await supabase
        .from("event_sources")
        .select("id, source_name, source_type, url, title, published_at, is_institutional, is_major_media")
        .eq("event_id", eventId!)
        .order("published_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as RadarEventSource[];
    },
  });
}
