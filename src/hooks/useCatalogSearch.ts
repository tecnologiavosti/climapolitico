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
  ai_generated?: boolean;
}

export const PAGE_SIZE = 50;

export function useCatalogSearch(filters: CatalogFilters) {
  return useQuery({
    queryKey: ["tse-search", filters],
    queryFn: async () => {
      const payload = {
        q: filters.q?.trim() || null,
        cargo: filters.cargo?.length ? filters.cargo : null,
        partido: filters.partido?.length ? filters.partido : null,
        regiao: filters.regiao?.length ? filters.regiao : null,
        estado: filters.estado?.length ? filters.estado : null,
        municipio: filters.municipio?.trim() || null,
        onlyEleitos: !!filters.onlyEleitos,
        page: filters.page ?? 0,
      };
      console.log("[catalog] Filtros enviados:", payload);
      const { data, error } = await supabase.functions.invoke("tse-search", { body: payload });
      if (error) throw error;
      console.log("[catalog] Resultados TSE:", data);

      const rows = (data?.rows ?? []) as PoliticianRow[];
      return {
        rows,
        total: Number(data?.total ?? 0),
        suggestions: (data?.suggestions ?? []) as Suggestion[],
        normalized: (data?.normalized ?? {}) as Record<string, string>,
        notice: (data?.notice ?? null) as string | null,
        page: data?.page ?? 0,
      };
    },
    staleTime: 60_000,
  });
}
