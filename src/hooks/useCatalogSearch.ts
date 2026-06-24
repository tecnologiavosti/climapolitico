import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CatalogFilters {
  q?: string;
  position?: string;
  party?: string;
  state?: string;
  city?: string;
  region?: string;
  order?: "relevance" | "popularity" | "name";
}

export interface CatalogRow {
  id: string;
  full_name: string;
  party: string | null;
  party_number: string | null;
  cargo: string | null;
  state: string | null;
  city: string | null;
  macro_region: string | null;
  region: string | null;
  photo_url: string | null;
  monitorable_networks: string[] | null;
  social_links: Record<string, string> | null;
  social_media_link: string | null;
  description: string | null;
  popularity_score: number;
  total_count: number;
}

const PAGE_SIZE = 24;

export function useCatalogSearch(filters: CatalogFilters) {
  return useInfiniteQuery({
    queryKey: ["catalog-search", filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await (supabase as any).rpc("search_catalog", {
        q: filters.q?.trim() || null,
        p_position: filters.position || null,
        p_party: filters.party || null,
        p_state: filters.state || null,
        p_city: filters.city || null,
        p_region: filters.region || null,
        p_order: filters.order || "relevance",
        p_limit: PAGE_SIZE,
        p_offset: pageParam as number,
      });
      if (error) throw error;
      return {
        rows: (data ?? []) as CatalogRow[],
        nextOffset: (data?.length ?? 0) === PAGE_SIZE ? (pageParam as number) + PAGE_SIZE : null,
        total: (data?.[0]?.total_count as number) ?? 0,
      };
    },
    getNextPageParam: (last) => last.nextOffset,
    staleTime: 60_000,
  });
}
