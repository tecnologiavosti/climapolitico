import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Search, X } from "lucide-react";
import type { CatalogFilters as Filters } from "@/hooks/useCatalogSearch";

const POSITIONS: [string, string][] = [
  ["presidente", "Presidente"],
  ["vice_presidente", "Vice-presidente"],
  ["governador", "Governador"],
  ["vice_governador", "Vice-governador"],
  ["senador", "Senador"],
  ["deputado_federal", "Deputado Federal"],
  ["deputado_estadual", "Deputado Estadual"],
  ["deputado_distrital", "Deputado Distrital"],
  ["prefeito", "Prefeito"],
  ["vice_prefeito", "Vice-prefeito"],
  ["vereador", "Vereador"],
];

const REGIONS: [string, string][] = [
  ["norte", "Norte"],
  ["nordeste", "Nordeste"],
  ["centro-oeste", "Centro-Oeste"],
  ["sudeste", "Sudeste"],
  ["sul", "Sul"],
];

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  totalResults?: number;
}

const ALL = "__all__";

export function CatalogFilters({ filters, onChange, totalResults }: Props) {
  // Single-select wrappers (RPC accepts arrays — pass [v] or undefined)
  const setSingle = (k: "cargo" | "partido" | "regiao" | "estado", v: string) => {
    onChange({ ...filters, page: 0, [k]: v === ALL ? undefined : [v] });
  };

  const hasFilters = !!(
    filters.q || filters.cargo?.length || filters.partido?.length ||
    filters.regiao?.length || filters.estado?.length || filters.municipio || filters.onlyEleitos
  );

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-3 border-b">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome (tolera acentos e erros de digitação)…"
            value={filters.q ?? ""}
            onChange={(e) => onChange({ ...filters, page: 0, q: e.target.value })}
            className="pl-10"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <Select value={filters.cargo?.[0] ?? ALL} onValueChange={(v) => setSingle("cargo", v)}>
            <SelectTrigger><SelectValue placeholder="Cargo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos os cargos</SelectItem>
              {POSITIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            placeholder="Partido (sigla)"
            value={filters.partido?.[0] ?? ""}
            onChange={(e) => onChange({
              ...filters, page: 0,
              partido: e.target.value ? [e.target.value.toUpperCase()] : undefined
            })}
          />

          <Select value={filters.regiao?.[0] ?? ALL} onValueChange={(v) => setSingle("regiao", v)}>
            <SelectTrigger><SelectValue placeholder="Região" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as regiões</SelectItem>
              {REGIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.estado?.[0] ?? ALL} onValueChange={(v) => setSingle("estado", v)}>
            <SelectTrigger><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Todos os estados</SelectItem>
              {UFS.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
            </SelectContent>
          </Select>

          <Input
            placeholder="Município"
            value={filters.municipio ?? ""}
            onChange={(e) => onChange({ ...filters, page: 0, municipio: e.target.value })}
          />

          <div className="flex items-center gap-2 px-2 border rounded-md">
            <Switch
              id="only-eleitos"
              checked={!!filters.onlyEleitos}
              onCheckedChange={(v) => onChange({ ...filters, page: 0, onlyEleitos: v })}
            />
            <Label htmlFor="only-eleitos" className="text-sm cursor-pointer">Somente eleitos</Label>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{totalResults !== undefined ? `${totalResults.toLocaleString("pt-BR")} resultados` : ""}</span>
          {hasFilters && (
            <Button size="sm" variant="ghost" onClick={() => onChange({})}>
              <X className="h-3 w-3 mr-1" /> Limpar filtros
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
