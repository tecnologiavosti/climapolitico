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
  from?: Date;
  to?: Date;
  category?: string;
  search?: string;
}

export function useRadarEvents(filters: RadarFilters) {
  const { user } = useAuth();
  const key = {
    candidateId: filters.candidateId,
    from: filters.from?.toISOString(),
    to: filters.to?.toISOString(),
    category: filters.category,
    search: filters.search,
  };

  return useQuery({
    queryKey: ["radar-events", user?.id, key],
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
        .limit(1000);

      if (filters.candidateId) q = q.eq("candidate_id", filters.candidateId);
      if (filters.from) q = q.gte("event_date", filters.from.toISOString());
      if (filters.to) q = q.lte("event_date", filters.to.toISOString());
      if (filters.category && filters.category !== "all") {
        q = q.or(`category.eq.${filters.category},category_v2.eq.${filters.category}`);
      }
      if (filters.search?.trim()) {
        const s = filters.search.trim().replace(/[%,]/g, "");
        q = q.or(`title.ilike.%${s}%,summary.ilike.%${s}%,ai_summary.ilike.%${s}%`);
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
