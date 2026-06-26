import { useCallback, useEffect, useMemo, useState } from "react";

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
import { normalizeCandidateName, suggestCandidateNames, type NameSuggestion } from "@/lib/candidateNameNormalizer";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  isNameFormatValid, isBlacklisted, computeExistenceScore, levelFromScore,
  signalsFromAiLookup, scopeLabel,
} from "@/lib/candidateValidation";

import { BRAZILIAN_PARTIES as PARTIES, POPULAR_PARTY_SIGLAS, findPartyBySigla, type BrazilianParty as Party } from "@/lib/brazilianParties";

const POSITIONS: { name: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  // Executivo
  { name: "Presidente", Icon: Landmark },
  { name: "Vice-presidente", Icon: Landmark },
  { name: "Ministro", Icon: Scroll },
  { name: "Governador", Icon: Building2 },
  { name: "Vice-governador", Icon: Building2 },
  { name: "Secretário Estadual", Icon: Building2 },
  { name: "Prefeito", Icon: Building },
  { name: "Vice-prefeito", Icon: Building },
  { name: "Secretário Municipal", Icon: Building },
  // Legislativo
  { name: "Senador", Icon: Scroll },
  { name: "Deputado Federal", Icon: ClipboardList },
  { name: "Deputado Estadual", Icon: FileText },
  { name: "Deputado Distrital", Icon: FileText },
  { name: "Vereador", Icon: User },
  // Partidário
  { name: "Presidente de partido", Icon: Landmark },
];

const NATIONAL_POSITIONS = new Set(["Presidente", "Vice-presidente", "Ministro", "Presidente de partido"]);
const STATE_POSITIONS = new Set(["Governador", "Vice-governador", "Secretário Estadual", "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital"]);
const MUNICIPAL_POSITIONS = new Set(["Prefeito", "Vice-prefeito", "Secretário Municipal", "Vereador"]);
const VALID_POSITIONS = new Set(POSITIONS.map((p) => p.name));

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
  profileType: "politician";
  fullName: string;
  party: string;
  partyName?: string;
  partyNumber?: number;
  position: string;
  region: string;
  state: string;
  city?: string;
  socials: Record<string, string>;
  photoFile: File | null;
};

export type AddCandidateInitialValues = {
  fullName?: string;
  party?: string;
  position?: string;
  state?: string;
  city?: string;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isPending: boolean;
  trigger?: React.ReactNode;
  onSubmit: (data: AddCandidatePayload) => void;
  /** Nomes já cadastrados (conta do usuário + catálogo público) para sugestão e dedup. */
  knownNames?: string[];
  /** Pré-preenche os campos ao abrir o modal. */
  initialValues?: AddCandidateInitialValues;
}


export function AddCandidateDialog({ open, onOpenChange, isPending, trigger, onSubmit, knownNames = [], initialValues }: Props) {
  const [fullName, setFullName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [party, setParty] = useState("");
  const [position, setPosition] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Debounce 600ms para validação IA
  useEffect(() => {
    const t = setTimeout(() => setDebouncedName(fullName), 600);
    return () => clearTimeout(t);
  }, [fullName]);

  const suggestions = useMemo<NameSuggestion[]>(() => {
    const q = debouncedName.trim();
    if (q.length < 2) return [];
    return suggestCandidateNames(q, knownNames, 0.75);
  }, [debouncedName, knownNames]);

  const autoCorrect = suggestions.find((s) => s.similarity >= 0.98) ?? null;

  const applySuggestion = (s: NameSuggestion) => {
    setFullName(s.fullName);
    if (s.meta?.party) setParty(s.meta.party);
    if (s.meta?.position && VALID_POSITIONS.has(s.meta.position)) {
      setPosition(s.meta.position);
      const next = scopeOf(s.meta.position);
      if (next === "national") { setState(""); setCity(""); }
    }
    if (s.meta?.state) setState(s.meta.state);
    if (s.meta?.city) setCity(s.meta.city);
  };

  // Match exato no catálogo (>= 95%) — usado para card "Candidato identificado"
  const catalogMatch = useMemo(() => {
    const top = suggestions[0];
    if (top && normalizeCandidateName(fullName) !== normalizeCandidateName(top.fullName)) return null;
    if (top && top.similarity >= 0.95 && top.meta) return top;
    return null;
  }, [fullName, suggestions]);

  // Debug
  useEffect(() => {
    if (!debouncedName.trim()) return;
    console.log("[Candidate metadata]", {
      name: debouncedName,
      foundInCatalog: !!catalogMatch,
      party: catalogMatch?.meta?.party ?? null,
      office: catalogMatch?.meta?.position ?? null,
      state: catalogMatch?.meta?.state ?? null,
    });
  }, [debouncedName, catalogMatch]);

  // ===== Validação semântica via Cerebras (única fonte) =====
  type AiLookup = {
    score: number;
    plausibility: "high" | "medium" | "low" | "suspect";
    reason: string;
    name: string | null;
    party: string | null;
    office: string | null;
    state: string | null;
    city: string | null;
    pending?: boolean;
    error?: string;
  };
  const [aiLookup, setAiLookup] = useState<AiLookup | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [lastValidatedQuery, setLastValidatedQuery] = useState("");
  const [validationAttempt, setValidationAttempt] = useState(0);
  const revalidate = useCallback(() => setValidationAttempt((n) => n + 1), []);

  // Contexto suficiente (depende do cargo) para acionar a IA.
  const ctxScope = scopeOf(position);
  const isMunicipal = ctxScope === "municipal";
  const hasEnoughContext =
    !!fullName.trim() && !!party && !!position &&
    (ctxScope === "national"
      || (ctxScope === "state" && !!state)
      || (ctxScope === "municipal" && !!state && !!city.trim()));
  const hasOnlyName = !!fullName.trim() && !party && !position && !state && !city.trim();
  const validationQuery = useMemo(() => {
    const name = debouncedName.trim();
    if (!name || !hasEnoughContext) return "";
    return [name, position, party, isMunicipal ? city.trim() : "", state].filter(Boolean).join(" ");
  }, [debouncedName, hasEnoughContext, position, party, isMunicipal, city, state]);
  const hasValidatedCurrentQuery =
    hasEnoughContext && !!validationQuery && lastValidatedQuery === validationQuery && !!aiLookup;

  useEffect(() => {
    const name = debouncedName.trim();
    setAiLookup(null);
    setLastValidatedQuery("");
    if (!hasEnoughContext || !validationQuery) { setAiLoading(false); return; }
    if (name.length < 3) return;

    let cancelled = false;
    setAiLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("lookup-candidate-ai", {
          body: { name, context: { party, office: position, state, city: city.trim() } },
        });
        if (cancelled) return;
        const lookupErr = (data as { error?: string } | null)?.error;
        if (error || lookupErr) {
          console.warn("[lookup-candidate-ai] error", error || lookupErr);
          setAiLookup({ score: 0, plausibility: "low", reason: "", name: null, party: null, office: null, state: null, city: null, error: "lookup_failed" });
        } else {
          setAiLookup(data as AiLookup);
          console.log("[Candidate AI validation]", { query: validationQuery, result: data });
        }
        setLastValidatedQuery(validationQuery);
      } catch (err) {
        if (cancelled) return;
        console.warn("[lookup-candidate-ai] threw", err);
        setAiLookup({ score: 0, plausibility: "low", reason: "", name: null, party: null, office: null, state: null, city: null, error: "lookup_failed" });
        setLastValidatedQuery(validationQuery);
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedName, hasEnoughContext, validationQuery, party, position, state, city, validationAttempt]);

  // ===== Validação local de formato =====
  const formatOk = useMemo(() => isNameFormatValid(fullName), [fullName]);
  const blacklisted = useMemo(() => isBlacklisted(fullName), [fullName]);
  const aiScore = hasValidatedCurrentQuery && aiLookup && !aiLookup.error ? aiLookup.score : null;


  const nameError = useMemo(() => {
    if (!fullName.trim()) return null;
    if (blacklisted) return "Esse nome não parece ser um político brasileiro válido.";
    if (!formatOk) return "Digite nome e sobrenome válidos.";
    return null;
  }, [fullName, formatOk, blacklisted]);

  const scope = scopeOf(position);
  // Bloqueio hard: formato inválido ou blacklist. Score baixo abre modal de confirmação.
  const canSubmit =
    formatOk && !blacklisted && !!party && !!position && !isPending &&
    (scope === "national" || (scope === "state" && !!state) || (scope === "municipal" && !!state && !!city.trim()));

  const scopeBadge = useMemo(() => {
    if (scope === "national") return { label: "Atuação nacional · cobertura Brasil", cls: "bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30" };
    if (scope === "state") return { label: "Monitoramento estadual", cls: "bg-gradient-to-r from-blue-500/15 to-indigo-500/15 text-blue-600 dark:text-blue-300 border-blue-500/30" };
    if (scope === "municipal") return { label: "Monitoramento municipal", cls: "bg-gradient-to-r from-amber-500/15 to-orange-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30" };
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
    setFullName(""); setDebouncedName("");
    setParty(""); setPosition(""); setState(""); setCity(""); setErrors({});
  };

  const submitPayload = () => {
    const region = scope === "national" ? "Brasil" : (STATE_TO_REGION[state] ?? "");
    onSubmit({
      profileType: "politician",
      fullName, party,
      partyName: findPartyBySigla(party)?.nome,
      partyNumber: findPartyBySigla(party)?.numero,
      position, region,
      state,
      city: city.trim() || undefined,
      socials: {}, photoFile: null,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!formatOk) errs.fullName = "Digite nome e sobrenome válidos.";
    else if (blacklisted) errs.fullName = "Esse nome não parece ser um político brasileiro válido.";
    if (!party) errs.party = "Selecione um partido";
    if (!position) errs.position = "Selecione um cargo político";
    if (scope !== "national" && !state) errs.state = "Selecione um estado";
    if (scope === "municipal" && !city.trim()) errs.city = "Informe a cidade";
    setErrors(errs);
    if (Object.keys(errs).length) return;

    // Não bloqueia por score de IA — apenas alerta na UI. Usuário sempre pode adicionar.


    submitPayload();
  };


  const onOpen = (v: boolean) => {
    if (v && initialValues) {
      if (initialValues.fullName !== undefined) { setFullName(initialValues.fullName); setDebouncedName(initialValues.fullName); }
      if (initialValues.party !== undefined) setParty(initialValues.party);
      if (initialValues.position !== undefined && VALID_POSITIONS.has(initialValues.position)) {
        setPosition(initialValues.position);
        const next = scopeOf(initialValues.position);
        if (next === "national") { setState(""); setCity(""); }
      }
      if (initialValues.state !== undefined) setState(initialValues.state);
      if (initialValues.city !== undefined) setCity(initialValues.city);
    }
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
              autoComplete="off"
            />

            {fullName.trim().length >= 2 && (() => {
              // Hard block: nome quebrado ou blacklist mostram erro imediatamente.
              if (!formatOk || blacklisted) {
                return (
                  <div className="mt-2 rounded-xl border px-3 py-2.5 border-red-500/40 bg-red-500/[0.08] text-red-700 dark:text-red-300 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <div className="flex items-center gap-2 text-sm font-semibold">🔴 Nome inválido</div>
                    <div className="mt-0.5 text-xs opacity-80">{nameError}</div>
                  </div>
                );
              }
              // Sem contexto suficiente: nunca mostra Score 0.
              if (!hasEnoughContext) {
                const pendingTitle = hasOnlyName ? "⚪ Validação pendente" : "🟡 Aguardando contexto";
                const pendingText = hasOnlyName
                  ? "Complete os campos para validar"
                  : "Informe partido, cargo e localização para validar.";
                return (
                  <div className={cn(
                    "mt-2 rounded-xl border px-3 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-200",
                    hasOnlyName
                      ? "border-border/60 bg-muted/40 text-muted-foreground"
                      : "border-amber-500/40 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300",
                  )}>
                    <div className="flex items-center gap-2 text-sm font-semibold">{pendingTitle}</div>
                    <div className="mt-0.5 text-xs opacity-90">{pendingText}</div>
                  </div>
                );
              }
              // Validando…
              if (aiLoading || (!catalogMatch && !hasValidatedCurrentQuery)) {
                return (
                  <div className="mt-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 text-muted-foreground animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verificando candidato…
                    </div>
                    <div className="mt-0.5 text-xs opacity-90">Consultando TSE, sites oficiais e fontes públicas.</div>
                  </div>
                );
              }
              // Falha de chamada IA: nunca bloquear nem invalidar — apenas alertar.
              if (aiLookup?.error) {
                return (
                  <div className="mt-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2.5 text-amber-700 dark:text-amber-300 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                    <div className="flex items-center gap-2 text-sm font-semibold">🟡 Validação indisponível</div>
                    <div className="mt-0.5 text-xs opacity-80">Não foi possível consultar a IA agora. Você pode adicionar mesmo assim.</div>
                    <div className="mt-2">
                      <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" onClick={revalidate} disabled={aiLoading}>
                        {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Tentar validar novamente
                      </Button>
                    </div>
                  </div>
                );
              }
              // Resultado IA pronto: 4 faixas.
              const score = aiScore ?? 0;
              const tone =
                score >= 90 ? { icon: "🟢", title: "Validado pela IA", cls: "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300" }
                : score >= 70 ? { icon: "🟡", title: "Plausível", cls: "border-amber-500/40 bg-amber-500/[0.08] text-amber-700 dark:text-amber-300" }
                : score >= 40 ? { icon: "🟠", title: "Pouco confiável", cls: "border-orange-500/40 bg-orange-500/[0.08] text-orange-700 dark:text-orange-300" }
                : { icon: "🔴", title: "Suspeito", cls: "border-red-500/40 bg-red-500/[0.08] text-red-700 dark:text-red-300" };
              const subtitle =
                score >= 70 ? "Candidato plausível para monitoramento político."
                : score >= 40 ? "Dados parcialmente consistentes. Revise antes de adicionar."
                : "Este candidato parece inconsistente ou improvável.";
              const scopeTxt = scopeLabel(scope, state, city);
              return (
                <div className={cn("mt-2 rounded-xl border px-3 py-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-200", tone.cls)}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span>{tone.icon}</span> {tone.title}
                    </div>
                    <span className="text-xs font-medium opacity-80">Score: {score}/100</span>
                  </div>
                  <div className="mt-0.5 text-xs opacity-80">{subtitle}</div>
                  {aiLookup?.reason && (
                    <div className="mt-1 text-[11px] opacity-75 italic">{aiLookup.reason}</div>
                  )}
                  {scopeTxt && <div className="mt-1 text-xs font-medium opacity-90">{scopeTxt}</div>}
                  {score < 90 && (
                    <div className="mt-2">
                      <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg" onClick={revalidate} disabled={aiLoading}>
                        {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                        Tentar validar novamente
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}




            {autoCorrect && normalizeCandidateName(fullName) !== normalizeCandidateName(autoCorrect.fullName) && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2 text-sm">
                  <Wand2 className="h-4 w-4 text-primary" />
                  <span>Você quis dizer: <strong>{autoCorrect.fullName}</strong></span>
                </div>
                <Button type="button" size="sm" variant="secondary" className="h-7 rounded-lg" onClick={() => applySuggestion(autoCorrect)}>
                  Usar candidato
                </Button>
              </div>
            )}

            {!autoCorrect && suggestions.length > 0 && (
              <div className="mt-2 rounded-xl border border-border/70 bg-popover/95 backdrop-blur shadow-sm overflow-hidden animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40">
                  Você quis dizer:
                </div>
                <ul className="divide-y divide-border/50">
                  {suggestions.map((s) => (
                    <li key={s.fullName} className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/40 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                        <div className="min-w-0">
                        <div className="text-sm truncate">{s.fullName}</div>
                          {(s.meta?.party || s.meta?.position || s.meta?.state) && (
                            <div className="text-[11px] text-muted-foreground truncate">
                              {[s.meta?.position, s.meta?.state, s.meta?.city].filter(Boolean).join(" - ")}{s.meta?.party ? ` · ${s.meta.party}` : ""}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px] shrink-0">{Math.round(s.similarity * 100)}%</Badge>
                      </div>
                      <Button type="button" size="sm" variant="ghost" className="h-7 rounded-lg shrink-0" onClick={() => applySuggestion(s)}>
                        Usar candidato
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {catalogMatch && (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.08] px-3 py-2 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                <div className="flex items-center gap-2 text-sm min-w-0">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-semibold truncate">Candidato identificado: {catalogMatch.fullName}</div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {[catalogMatch.meta?.position, catalogMatch.meta?.party, catalogMatch.meta?.state].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" className="h-7 rounded-lg shrink-0" onClick={() => applySuggestion(catalogMatch)}>
                  Autopreencher
                </Button>
              </div>
            )}

            {!catalogMatch && suggestions.length === 0 && debouncedName.trim().length >= 4 && aiLoading && (
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Validando candidato com IA…
              </div>
            )}



            {scopeBadge && (
              <Badge variant="outline" className={cn("mt-2 font-medium", scopeBadge.cls)}>
                {scopeBadge.label}
              </Badge>
            )}
          </Field>

          {/* Partido */}
          <Field label="Partido" error={errors.party} required>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_PARTY_SIGLAS.map((sigla) => {
                  const isSel = party === sigla;
                  return (
                    <button
                      type="button"
                      key={sigla}
                      disabled={isPending}
                      onClick={() => setParty(isSel ? "" : sigla)}
                      className={cn(
                        "px-3 h-8 rounded-full text-xs font-semibold border transition-all",
                        "hover:scale-[1.03] active:scale-[0.97]",
                        isSel
                          ? "bg-primary text-primary-foreground border-primary shadow-sm"
                          : "bg-muted/40 border-border/60 text-foreground hover:bg-muted",
                      )}
                    >
                      {sigla}
                    </button>
                  );
                })}
              </div>
              <PartyCombobox value={party} onChange={setParty} disabled={isPending} />
            </div>
          </Field>

          {/* Cargo político */}
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
                <Field label="Estado e cidade" error={errors.state || errors.city} required>
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




          {/* Preview — só aparece quando nome, partido e cargo são válidos */}
          {fullName.trim() && party && position && (
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
                  <div className="text-base font-semibold truncate">{fullName.trim()}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {[
                      party,
                      position,
                      scope === "national" ? "Brasil" : (city && state ? `${city}/${state}` : (state && (STATE_NAMES[state] ?? state))),
                    ].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </div>
            </div>
          )}
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

