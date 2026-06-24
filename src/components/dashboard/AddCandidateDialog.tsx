import { useEffect, useMemo, useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  UserPlus, Loader2, Landmark, Building2, Building, Scroll, FileText, ClipboardList, User,
  Sparkles, Check, ChevronsUpDown, Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { nameSimilarity, normalizeCandidateName } from "@/lib/candidateNameNormalizer";

type Party = { sigla: string; nome: string; numero: number };

const PARTIES: Party[] = [
  { sigla: "MDB", nome: "Movimento Democrático Brasileiro", numero: 15 },
  { sigla: "PDT", nome: "Partido Democrático Trabalhista", numero: 12 },
  { sigla: "PT", nome: "Partido dos Trabalhadores", numero: 13 },
  { sigla: "PCdoB", nome: "Partido Comunista do Brasil", numero: 65 },
  { sigla: "PSB", nome: "Partido Socialista Brasileiro", numero: 40 },
  { sigla: "PSDB", nome: "Partido da Social Democracia Brasileira", numero: 45 },
  { sigla: "AGIR", nome: "AGIR", numero: 36 },
  { sigla: "MOBILIZA", nome: "Mobilização Nacional", numero: 33 },
  { sigla: "CIDADANIA", nome: "Cidadania", numero: 23 },
  { sigla: "PV", nome: "Partido Verde", numero: 43 },
  { sigla: "AVANTE", nome: "Avante", numero: 70 },
  { sigla: "PP", nome: "Progressistas", numero: 11 },
  { sigla: "PSTU", nome: "Partido Socialista dos Trabalhadores Unificado", numero: 16 },
  { sigla: "PCB", nome: "Partido Comunista Brasileiro", numero: 21 },
  { sigla: "PRTB", nome: "Partido Renovador Trabalhista Brasileiro", numero: 28 },
  { sigla: "DC", nome: "Democracia Cristã", numero: 27 },
  { sigla: "PCO", nome: "Partido da Causa Operária", numero: 29 },
  { sigla: "PODE", nome: "Podemos", numero: 20 },
  { sigla: "REPUBLICANOS", nome: "Republicanos", numero: 10 },
  { sigla: "PSOL", nome: "Partido Socialismo e Liberdade", numero: 50 },
  { sigla: "PL", nome: "Partido Liberal", numero: 22 },
  { sigla: "PSD", nome: "Partido Social Democrático", numero: 55 },
  { sigla: "SOLIDARIEDADE", nome: "Solidariedade", numero: 77 },
  { sigla: "NOVO", nome: "Partido Novo", numero: 30 },
  { sigla: "REDE", nome: "Rede Sustentabilidade", numero: 18 },
  { sigla: "DEMOCRATA", nome: "Democrata", numero: 35 },
  { sigla: "UP", nome: "Unidade Popular", numero: 80 },
  { sigla: "UNIÃO", nome: "União Brasil", numero: 44 },
  { sigla: "PRD", nome: "Partido Renovação Democrática", numero: 25 },
  { sigla: "MISSÃO", nome: "Partido Missão", numero: 14 },
];

const POSITIONS: { name: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { name: "Presidente", Icon: Landmark },
  { name: "Vice-presidente", Icon: Landmark },
  { name: "Ministro", Icon: Scroll },
  { name: "Governador", Icon: Building2 },
  { name: "Vice-governador", Icon: Building2 },
  { name: "Senador", Icon: Scroll },
  { name: "Deputado Federal", Icon: ClipboardList },
  { name: "Deputado Estadual", Icon: FileText },
  { name: "Prefeito", Icon: Building },
  { name: "Vice-prefeito", Icon: Building },
  { name: "Vereador", Icon: User },
];

const NATIONAL_POSITIONS = new Set(["Presidente", "Vice-presidente", "Ministro"]);
const STATE_POSITIONS = new Set(["Governador", "Vice-governador", "Senador", "Deputado Federal", "Deputado Estadual"]);
const MUNICIPAL_POSITIONS = new Set(["Prefeito", "Vice-prefeito", "Vereador"]);

type Scope = "national" | "state" | "municipal" | "none";
const scopeOf = (p: string): Scope =>
  NATIONAL_POSITIONS.has(p) ? "national"
  : STATE_POSITIONS.has(p) ? "state"
  : MUNICIPAL_POSITIONS.has(p) ? "municipal"
  : "none";

const REGIONS: Record<string, string[]> = {
  "Norte": ["AC", "AP", "AM", "PA", "RO", "RR", "TO"],
  "Nordeste": ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MT", "MS"],
  "Sudeste": ["SP", "RJ", "MG", "ES"],
  "Sul": ["PR", "SC", "RS"],
};

const STATE_TO_REGION: Record<string, string> = Object.entries(REGIONS).reduce((acc, [r, sts]) => {
  sts.forEach((s) => { acc[s] = r; });
  return acc;
}, {} as Record<string, string>);

const STATE_NAMES: Record<string, string> = {
  AC: "Acre", AP: "Amapá", AM: "Amazonas", PA: "Pará", RO: "Rondônia", RR: "Roraima", TO: "Tocantins",
  AL: "Alagoas", BA: "Bahia", CE: "Ceará", MA: "Maranhão", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", RN: "Rio Grande do Norte", SE: "Sergipe",
  DF: "Distrito Federal", GO: "Goiás", MT: "Mato Grosso", MS: "Mato Grosso do Sul",
  SP: "São Paulo", RJ: "Rio de Janeiro", MG: "Minas Gerais", ES: "Espírito Santo",
  PR: "Paraná", SC: "Santa Catarina", RS: "Rio Grande do Sul",
};

const ALL_STATES = Object.keys(STATE_NAMES).sort();

export type AddCandidatePayload = {
  fullName: string;
  party: string;
  position: string;
  region: string;
  state: string;
  city?: string;
  socials: Record<string, string>;
  photoFile: File | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isPending: boolean;
  trigger?: React.ReactNode;
  onSubmit: (data: AddCandidatePayload) => void;
}


export function AddCandidateDialog({ open, onOpenChange, isPending, trigger, onSubmit }: Props) {
  const [fullName, setFullName] = useState("");
  const [party, setParty] = useState("");
  const [position, setPosition] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const scope = scopeOf(position);
  const canSubmit =
    !!fullName.trim() && !!party && !!position && !isPending &&
    (scope === "national" || (scope === "state" && !!state) || (scope === "municipal" && !!state && !!city.trim()));

  const scopeBadge = useMemo(() => {
    if (scope === "national") return { label: "Atuação nacional · cobertura Brasil", cls: "bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" };
    if (scope === "state") return { label: "Monitoramento estadual", cls: "bg-gradient-to-r from-blue-500/15 to-indigo-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" };
    if (scope === "municipal") return { label: "Base municipal", cls: "bg-gradient-to-r from-amber-500/15 to-orange-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" };
    return null;
  }, [scope]);

  const helperText = useMemo(() => {
    if (position === "Presidente" || position === "Vice-presidente" || position === "Ministro")
      return "Este cargo é monitorado em escala nacional.";
    if (position === "Governador" || position === "Vice-governador") return "Selecione o estado principal de atuação.";
    if (position === "Senador" || position === "Deputado Federal" || position === "Deputado Estadual")
      return "Selecione o estado de atuação parlamentar.";
    if (position === "Prefeito" || position === "Vice-prefeito" || position === "Vereador")
      return "Selecione município e estado.";
    return null;
  }, [position]);

  const handlePosition = (p: string) => {
    setPosition(p);
    const next = scopeOf(p);
    if (next === "national") { setState(""); setCity(""); }
    else if (next === "state") { setCity(""); }
  };

  const reset = () => {
    setFullName(""); setParty(""); setPosition(""); setState(""); setCity(""); setErrors({});
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (fullName.trim().length < 3) errs.fullName = "Nome deve ter no mínimo 3 caracteres";
    if (!party) errs.party = "Selecione um partido";
    if (!position) errs.position = "Selecione um cargo";
    if (scope !== "national" && !state) errs.state = "Selecione um estado";
    if (scope === "municipal" && !city.trim()) errs.city = "Informe a cidade";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const region = scope === "national" ? "Brasil" : (STATE_TO_REGION[state] ?? "");
    onSubmit({
      fullName, party, position, region, state, city: city.trim() || undefined,
      socials: {}, photoFile: null,
    });
  };

  const onOpen = (v: boolean) => {
    if (!v && !isPending) reset();
    onOpenChange(v);
  };



  return (
    <Dialog open={open} onOpenChange={onOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className={cn(
          "sm:max-w-[760px] max-h-[92vh] overflow-y-auto p-0 gap-0",
          "rounded-3xl border-border/60 shadow-2xl",
          "bg-background/95 backdrop-blur-xl",
          "animate-in fade-in-0 zoom-in-95 duration-200",
        )}
      >
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-border/50 bg-gradient-to-b from-primary/[0.04] to-transparent">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 flex items-center justify-center ring-1 ring-primary/20 shadow-sm">
                <Landmark className="h-5 w-5 text-primary" />
              </div>
              <div>
                <DialogTitle className="text-xl tracking-tight">Adicionar novo candidato</DialogTitle>
                <DialogDescription className="text-sm">
                  Cadastre um candidato para monitoramento político em tempo real.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-7 space-y-7">
          {/* Nome */}
          <Field label="Nome completo" error={errors.fullName} required>
            <Input
              id="fullName"
              placeholder="Ex: Luiz Inácio Lula da Silva"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              disabled={isPending}
              className="h-12 text-base rounded-xl"
            />
            {scopeBadge && (
              <Badge variant="outline" className={cn("mt-2 font-medium", scopeBadge.cls)}>
                {scopeBadge.label}
              </Badge>
            )}
          </Field>

          {/* Partido */}
          <Field label="Partido" error={errors.party} required>
            <PartyCombobox value={party} onChange={setParty} disabled={isPending} />
          </Field>


          {/* Cargo */}
          <Field label="Cargo" error={errors.position} required>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
              {POSITIONS.map(({ name, Icon }) => {
                const selected = position === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => handlePosition(name)}
                    disabled={isPending}
                    className={cn(
                      "group flex flex-col items-start gap-2 p-3.5 rounded-xl border text-left transition-all duration-200",
                      "hover:border-primary/40 hover:shadow-sm hover:-translate-y-0.5",
                      selected
                        ? "border-primary/60 bg-gradient-to-br from-primary/10 to-primary/[0.02] ring-1 ring-primary/30 shadow-md"
                        : "border-border/70 bg-muted/20",
                    )}
                  >
                    <div className={cn(
                      "h-8 w-8 rounded-lg flex items-center justify-center transition-colors",
                      selected ? "bg-primary/15 text-primary" : "bg-background text-muted-foreground group-hover:text-foreground",
                    )}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className={cn("text-sm font-medium leading-tight", selected ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Localização — condicional ao cargo */}
          {scope !== "none" && (
            <div className="animate-in fade-in-0 slide-in-from-top-2 duration-300">
              {scope === "national" ? (
                <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-cyan-500/5 px-4 py-3 flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                    <Landmark className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Atuação nacional · cobertura Brasil</div>
                    {helperText && <div className="text-xs text-muted-foreground">{helperText}</div>}
                  </div>
                </div>
              ) : scope === "state" ? (
                <Field label="Estado de atuação" error={errors.state} required>
                  <Select value={state} onValueChange={setState} disabled={isPending}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Selecione o estado" /></SelectTrigger>
                    <SelectContent>
                      {ALL_STATES.map((s) => <SelectItem key={s} value={s}>{STATE_NAMES[s]} ({s})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
                </Field>
              ) : (
                <Field label="Base municipal" error={errors.state || errors.city} required>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Select value={state} onValueChange={setState} disabled={isPending}>
                      <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Estado" /></SelectTrigger>
                      <SelectContent>
                        {ALL_STATES.map((s) => <SelectItem key={s} value={s}>{STATE_NAMES[s]} ({s})</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Cidade"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      disabled={isPending || !state}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
                </Field>
              )}
            </div>
          )}


          {/* Preview */}
          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-muted/40 via-muted/20 to-transparent p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview do candidato</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-1 ring-border/60">
                <User className="h-5 w-5 text-primary/70" />
              </div>
              <div className="min-w-0">
                <div className="text-base font-semibold truncate">
                  {fullName.trim() || <span className="text-muted-foreground font-normal">Nome do candidato</span>}
                </div>
                <div className="text-sm text-muted-foreground truncate">
                  {[party, position, scope === "national" ? "Brasil" : (city && state ? `${city}/${state}` : (state && (STATE_NAMES[state] ?? state)))].filter(Boolean).join(" · ") || "Partido · Cargo · Localização"}
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-8 py-4 border-t border-border/60 bg-background/80 backdrop-blur sticky bottom-0">
          <Button type="button" variant="outline" onClick={() => onOpen(false)} disabled={isPending} className="rounded-xl">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleSubmit as unknown as React.MouseEventHandler<HTMLButtonElement>}
            disabled={!canSubmit}
            className="min-w-[200px] h-11 rounded-xl shadow-md hover:shadow-lg transition-all"
          >
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</>
            ) : (
              <><UserPlus className="mr-2 h-4 w-4" /> Adicionar candidato</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, error, required, children,
}: { label: string; error?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <Label className="text-sm font-semibold">
        {label} {required && <span className="text-primary/70">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function PartyCombobox({
  value, onChange, disabled,
}: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const selected = PARTIES.find((p) => p.sigla === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full h-12 flex items-center justify-between gap-2 rounded-xl border px-4 text-sm transition-all duration-200",
            "bg-background hover:border-primary/40",
            selected
              ? "border-primary/60 ring-2 ring-primary/20 shadow-[0_0_0_4px_hsl(var(--primary)/0.08)]"
              : "border-input",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 min-w-0">
              <span className="font-semibold text-foreground">{selected.sigla}</span>
              <span className="text-muted-foreground truncate">· {selected.nome}</span>
              <span className="text-xs text-muted-foreground shrink-0">({selected.numero})</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Buscar por sigla, nome ou número…</span>
          )}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width] rounded-xl" align="start">
        <Command
          filter={(itemValue, search) => {
            const q = search.toLowerCase().trim();
            if (!q) return 1;
            return itemValue.toLowerCase().includes(q) ? 1 : 0;
          }}
        >
          <CommandInput placeholder="Buscar partido…" className="h-11" />
          <CommandList className="max-h-72">
            <CommandEmpty>Nenhum partido encontrado.</CommandEmpty>
            <CommandGroup>
              {PARTIES.map((p) => {
                const isSel = value === p.sigla;
                return (
                  <CommandItem
                    key={p.sigla}
                    value={`${p.sigla} ${p.nome} ${p.numero}`}
                    onSelect={() => { onChange(p.sigla); setOpen(false); }}
                    className="cursor-pointer"
                  >
                    <Check className={cn("mr-2 h-4 w-4 transition-opacity", isSel ? "opacity-100 text-primary" : "opacity-0")} />
                    <span className="font-semibold mr-1.5">{p.sigla}</span>
                    <span className="text-muted-foreground truncate">· {p.nome}</span>
                    <span className="ml-auto text-xs text-muted-foreground">({p.numero})</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

