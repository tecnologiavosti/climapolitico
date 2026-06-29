import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { BRAZILIAN_PARTIES } from "@/lib/brazilianParties";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Search, X, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATES, STATES_BY_REGION } from "@/data/states";
import { MUNICIPIOS_BY_STATE } from "@/data/municipios";
import type { CatalogFilters as Filters } from "@/hooks/useCatalogSearch";

// Whitelist final de cargos aceitos no catálogo
export const ALLOWED_CARGOS = [
  "presidente",
  "governador",
  "senador",
  "deputado_federal",
  "deputado_estadual",
  "prefeito",
  "vice_prefeito",
  "vereador",
] as const;

const POSITIONS: [string, string][] = [
  ["presidente", "Presidente"],
  ["governador", "Governador"],
  ["senador", "Senador"],
  ["deputado_federal", "Deputado Federal"],
  ["deputado_estadual", "Deputado Estadual"],
  ["prefeito", "Prefeito"],
  ["vice_prefeito", "Vice-Prefeito"],
  ["vereador", "Vereador"],
];

const REGIONS: [string, string][] = [
  ["norte", "Norte"],
  ["nordeste", "Nordeste"],
  ["centro-oeste", "Centro-Oeste"],
  ["sudeste", "Sudeste"],
  ["sul", "Sul"],
];

const UFS = STATES.map((s) => s.sigla).sort();
const REGION_STATES = STATES_BY_REGION;

interface Props {
  filters: Filters;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onChange: (f: Filters) => void;
  totalResults?: number;
  disabled?: boolean;
  onSubmit?: () => void;
}

const ALL = "__all__";

export function CatalogFilters({ filters, searchQuery, onSearchQueryChange, onChange, totalResults, disabled, onSubmit }: Props) {
  const [muniOpen, setMuniOpen] = useState(false);
  // Single-select wrappers (RPC accepts arrays — pass [v] or undefined)
  const setSingle = (k: "cargo" | "partido" | "regiao" | "estado", v: string) => {
    const next: Filters = { ...filters, page: 0, [k]: v === ALL ? undefined : [v] };
    if (k === "regiao") {
      // Reset estado e municipio quando trocar de região
      next.estado = undefined;
      next.municipio = undefined;
    }
    if (k === "estado") {
      // Reset municipio quando trocar de estado
      next.municipio = undefined;
    }
    console.log(`[CatalogFilters] setSingle ${k} =`, v, "→ next:", next);
    onChange(next);
  };

  const selectedRegion = filters.regiao?.[0];
  const availableUFs = selectedRegion && REGION_STATES[selectedRegion]
    ? REGION_STATES[selectedRegion]
    : UFS;
  const selectedEstado = filters.estado?.[0];
  const estadoSelected = !!selectedEstado;
  const availableMunis = useMemo(
    () => (selectedEstado ? MUNICIPIOS_BY_STATE[selectedEstado] ?? [] : []),
    [selectedEstado],
  );

  const hasFilters = !!(
    filters.q || filters.cargo?.length || filters.partido?.length ||
    filters.regiao?.length || filters.estado?.length || filters.municipio || filters.onlyEleitos
  );

  return (
    <fieldset disabled={disabled} className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 py-3 border-b disabled:opacity-60">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome (Enter para buscar)…"
            value={searchQuery}
            onChange={(e) => {
              console.log("INPUT:", e.target.value);
              onSearchQueryChange(e.target.value);
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit?.(); } }}
            className="pl-10"
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <Select value={filters.cargo?.[0] ?? ALL} onValueChange={(v) => setSingle("cargo", v)}>
            <SelectTrigger><SelectValue placeholder="Cargo" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Selecionar cargo</SelectItem>
              {POSITIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select
            value={filters.partido?.[0] ?? ALL}
            onValueChange={(v) => setSingle("partido", v)}
          >
            <SelectTrigger><SelectValue placeholder="Partido" /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value={ALL}>Todos os partidos</SelectItem>
              {BRAZILIAN_PARTIES.map((p) => (
                <SelectItem key={p.sigla} value={p.sigla}>
                  <span className="font-semibold">{p.sigla}</span>
                  <span className="text-muted-foreground ml-1">· {p.nome} ({p.numero})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.regiao?.[0] ?? ALL} onValueChange={(v) => setSingle("regiao", v)}>
            <SelectTrigger><SelectValue placeholder="Região" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as regiões</SelectItem>
              {REGIONS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={filters.estado?.[0] ?? ALL} onValueChange={(v) => setSingle("estado", v)}>
            <SelectTrigger>
              <SelectValue placeholder={selectedRegion ? `Estado (${availableUFs.length})` : "Estado"} />
            </SelectTrigger>
            <SelectContent className="max-h-72 animate-in fade-in-0 zoom-in-95">
              <SelectItem value={ALL}>{selectedRegion ? `Todos os estados do ${selectedRegion}` : "Todos os estados"}</SelectItem>
              {availableUFs.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
            </SelectContent>
          </Select>

          <Popover open={muniOpen} onOpenChange={(o) => estadoSelected && setMuniOpen(o)}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={muniOpen}
                disabled={!estadoSelected}
                className="justify-between font-normal disabled:opacity-60"
              >
                <span className={cn("truncate", !filters.municipio && "text-muted-foreground")}>
                  {filters.municipio || (estadoSelected ? "Digite ou selecione município" : "Selecione um estado primeiro")}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[--radix-popover-trigger-width] min-w-[260px] animate-in fade-in-0 zoom-in-95" align="start">
              <Command>
                <CommandInput placeholder="Buscar município..." />
                <CommandList>
                  <CommandEmpty>Nenhum município encontrado.</CommandEmpty>
                  <CommandGroup>
                    {filters.municipio && (
                      <CommandItem
                        value="__clear__"
                        onSelect={() => {
                          onChange({ ...filters, page: 0, municipio: undefined });
                          setMuniOpen(false);
                        }}
                      >
                        <X className="mr-2 h-4 w-4" /> Limpar seleção
                      </CommandItem>
                    )}
                    {availableMunis.map((nome) => (
                      <CommandItem
                        key={nome}
                        value={nome}
                        onSelect={() => {
                          onChange({ ...filters, page: 0, municipio: nome });
                          setMuniOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", filters.municipio === nome ? "opacity-100" : "opacity-0")} />
                        {nome}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2 px-2 border rounded-md">
            <Switch
              id="only-eleitos"
              checked={!!filters.onlyEleitos}
              onCheckedChange={(v) => onChange({ ...filters, page: 0, onlyEleitos: v })}
            />
            <Label htmlFor="only-eleitos" className="text-sm cursor-pointer">Somente eleitos</Label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground mr-1">Tipo:</span>
          {(["both", "official", "pre_candidate"] as const).map((t) => {
            const active = (filters.candidateType ?? "both") === t;
            const label = t === "both" ? "Ambos" : t === "official" ? "Oficiais TSE" : "Pré-candidatos IA";
            return (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ ...filters, page: 0, candidateType: t })}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {label}
              </button>
            );
          })}
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
    </fieldset>
  );
}
