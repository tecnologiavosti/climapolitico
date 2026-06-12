import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface RadarEvent {
  id: string;
  candidate_id: string;
  title: string;
  summary: string;
  category: string;
  event_date: string;
  source_count: number;
  social_score: number;
  importance: number;
  status: string;
  sources_json: Array<{
    source_name: string;
    url: string;
    type?: string;
    published_at?: string;
  }>;
}

export interface RadarFilters {
  candidateId?: string;
  year?: number;
  category?: string;
}

export function useRadarEvents(filters: RadarFilters) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["radar-events", user?.id, filters],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<RadarEvent[]> => {
      let q = supabase
        .from("political_events")
        .select(
          "id,candidate_id,title,event_name,summary,ai_summary,category,category_v2,event_date,source_count,total_sources,social_score,importance,importance_score,status,sources_json"
        )
        .eq("user_id", user!.id)
        .order("event_date", { ascending: false })
        .limit(500);

      if (filters.candidateId) q = q.eq("candidate_id", filters.candidateId);
      if (filters.year) {
        const start = `${filters.year}-01-01`;
        const end = `${filters.year + 1}-01-01`;
        q = q.gte("event_date", start).lt("event_date", end);
      }
      if (filters.category && filters.category !== "all") {
        q = q.or(`category.eq.${filters.category},category_v2.eq.${filters.category}`);
      }

      const { data, error } = await q;
      if (error) throw error;

      return (data ?? []).map((r: any) => ({
        id: r.id,
        candidate_id: r.candidate_id,
        title: r.title || r.event_name || "Evento",
        summary: r.summary || r.ai_summary || "",
        category: r.category || r.category_v2 || "Outros",
        event_date: r.event_date,
        source_count: r.source_count || r.total_sources || 0,
        social_score: Number(r.social_score) || 0,
        importance: Number(r.importance) || Number(r.importance_score) || 0,
        status: r.status || "pending",
        sources_json: Array.isArray(r.sources_json) ? r.sources_json : [],
      }));
    },
  });
}
