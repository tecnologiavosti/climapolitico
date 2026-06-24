import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CatalogFilters {
  q?: string;
  cargo?: string[];
  partido?: string[];
  regiao?: string[];
  estado?: string[];
  municipio?: string;
  onlyEleitos?: boolean;
  page?: number;
}

export interface PoliticianRow {
  id: string;
  tse_id: string | null;
  nome: string;
  nome_urna: string | null;
  partido_sigla: string | null;
  partido_nome: string | null;
  numero_partido: string | null;
  cargo: string | null;
  regiao: string | null;
  estado: string | null;
  municipio: string | null;
  eleito: boolean;
  ano_eleicao: number | null;
  foto_url: string | null;
  redes_sociais: Record<string, string> | null;
  popularidade: number;
  similarity: number;
  total_count: number;
}

export interface Suggestion {
  id: string;
  nome: string;
  partido_sigla: string | null;
  cargo: string | null;
  estado: string | null;
  similarity: number;
}

export const PAGE_SIZE = 50;

export function useCatalogSearch(filters: CatalogFilters) {
  const page = filters.page ?? 0;
  return useQuery({
    queryKey: ["politicians-search", filters],
    queryFn: async () => {
      const params = {
        q: filters.q?.trim() || null,
        p_cargo: filters.cargo?.length ? filters.cargo : null,
        p_partido: filters.partido?.length ? filters.partido : null,
        p_regiao: filters.regiao?.length ? filters.regiao : null,
        p_estado: filters.estado?.length ? filters.estado : null,
        p_municipio: filters.municipio?.trim() || null,
        p_only_eleitos: !!filters.onlyEleitos,
        p_limit: PAGE_SIZE,
        p_offset: page * PAGE_SIZE,
      };

      const { data, error } = await (supabase as any).rpc("search_politicians", params);
      if (error) throw error;

      const rows = (data ?? []) as PoliticianRow[];
      const total = rows[0]?.total_count ?? 0;

      let suggestions: Suggestion[] = [];
      if (rows.length === 0 && filters.q?.trim()) {
        const { data: sug } = await (supabase as any).rpc("suggest_politicians", {
          q: filters.q.trim(),
          p_limit: 5,
        });
        suggestions = (sug ?? []) as Suggestion[];
      }

      return { rows, total: Number(total), suggestions, page };
    },
    staleTime: 60_000,
  });
}
