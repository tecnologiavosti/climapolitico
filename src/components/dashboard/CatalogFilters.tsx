import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, X } from "lucide-react";
import type { CatalogFilters as Filters } from "@/hooks/useCatalogSearch";

const POSITIONS = [
  ["presidente", "Presidente"],
  ["vice_presidente", "Vice-presidente"],
  ["ministro", "Ministro"],
  ["governador", "Governador"],
  ["vice_governador", "Vice-governador"],
  ["senador", "Senador"],
  ["deputado_federal", "Deputado Federal"],
  ["deputado_estadual", "Deputado Estadual"],
  ["deputado_distrital", "Deputado Distrital"],
  ["prefeito", "Prefeito"],
  ["vice_prefeito", "Vice-prefeito"],
  ["vereador", "Vereador"],
  ["presidente_partido", "Presidente de Partido"],
  ["ex_candidato", "Ex-candidato"],
];

const REGIONS = [
  ["norte", "Norte"],
  ["nordeste", "Nordeste"],
  ["centro-oeste", "Centro-Oeste"],
  ["sudeste", "Sudeste"],
  ["sul", "Sul"],
];

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const ORDERS = [
  ["relevance", "Relevância"],
  ["popularity", "Popularidade"],
  ["name", "A–Z"],
];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  totalResults?: number;
}

export function CatalogFilters({ filters, onChange, totalResults }: Props) {
  const set = (k: keyof Filters, v: string) =>
    onChange({ ...filters, [k]: v === "__all__" ? undefined : v });

  const hasFilters = !!(filters.q || filters.position || filters.party || filters.state || filters.city || filters.region);

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-3 border-b">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome (tolera acentos e erros de digitação)…"
            value={filters.q ?? ""}
            onChange={(e) => onChange({ ...filters, q: e.target.value })}
            className="pl-10"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <Select value={filters.position ?? "__all__"} onValueChange={(v) => set("position", v)}>
            <SelectTrigger><SelectValue placeholder="Cargo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os cargos</SelectItem>
              {POSITIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            placeholder="Partido"
            value={filters.party ?? ""}
            onChange={(e) => set("party", e.target.value)}
          />

          <Select value={filters.region ?? "__all__"} onValueChange={(v) => set("region", v)}>
            <SelectTrigger><SelectValue placeholder="Região" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as regiões</SelectItem>
              {REGIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.state ?? "__all__"} onValueChange={(v) => set("state", v)}>
            <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__all__">Todos os estados</SelectItem>
              {UFS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            placeholder="Município"
            value={filters.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
          />

          <Select value={filters.order ?? "relevance"} onValueChange={(v) => set("order", v)}>
            <SelectTrigger><SelectValue placeholder="Ordenar" /></SelectTrigger>
            <SelectContent>
              {ORDERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{totalResults !== undefined ? `${totalResults.toLocaleString("pt-BR")} resultados` : ""}</span>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => onChange({ order: filters.order })}>
              <X className="h-3 w-3 mr-1" /> Limpar filtros
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
