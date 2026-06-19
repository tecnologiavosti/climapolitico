import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  MapPinned, Sparkles, TrendingUp, AlertTriangle, Target, ShieldAlert,
  CheckCircle2, Compass, CalendarRange, Users, Building2, Lightbulb,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BR_STATES_MAP } from "@/data/brStatesMap";
import { BR_MAP as BR_REGIONS_MAP } from "@/data/brRegionsMap";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

// ---------- Constantes ----------
const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
type Region = typeof REGIONS[number];

const UF_NAMES: Record<string, string> = {
  AC:"Acre",AL:"Alagoas",AP:"Amapá",AM:"Amazonas",BA:"Bahia",CE:"Ceará",DF:"Distrito Federal",
  ES:"Espírito Santo",GO:"Goiás",MA:"Maranhão",MT:"Mato Grosso",MS:"Mato Grosso do Sul",
  MG:"Minas Gerais",PA:"Pará",PB:"Paraíba",PR:"Paraná",PE:"Pernambuco",PI:"Piauí",
  RJ:"Rio de Janeiro",RN:"Rio Grande do Norte",RS:"Rio Grande do Sul",RO:"Rondônia",
  RR:"Roraima",SC:"Santa Catarina",SP:"São Paulo",SE:"Sergipe",TO:"Tocantins",
};

const UF_REGION: Record<string, Region> = {
  AC:"Norte",AM:"Norte",AP:"Norte",PA:"Norte",RO:"Norte",RR:"Norte",TO:"Norte",
  AL:"Nordeste",BA:"Nordeste",CE:"Nordeste",MA:"Nordeste",PB:"Nordeste",PE:"Nordeste",
  PI:"Nordeste",RN:"Nordeste",SE:"Nordeste",
  DF:"Centro-Oeste",GO:"Centro-Oeste",MT:"Centro-Oeste",MS:"Centro-Oeste",
  ES:"Sudeste",MG:"Sudeste",RJ:"Sudeste",SP:"Sudeste",
  PR:"Sul",RS:"Sul",SC:"Sul",
};

const TEMA_LABELS: Record<string, string> = {
  agro: "Agro",
  seguranca: "Segurança",
  economia: "Economia",
  corrupcao: "Corrupção",
  costumes: "Costumes",
  saude: "Saúde",
};

const SEGMENTO_LABELS: Record<string, string> = {
  agro: "Agro",
  evangelicos: "Evangélicos",
  empresarios: "Empresários",
  jovens_urbanos: "Jovens urbanos",
  servidores: "Servidores",
  classe_media: "Classe média",
};

type PeriodKey = "7d" | "30d" | "90d" | "1y" | "custom";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "1y", label: "1 ano" },
  { key: "custom", label: "Personalizado" },
];

const LOADING_MESSAGES = [
  "Analisando percepção estado a estado...",
  "Mapeando forças eleitorais...",
  "Cruzando perfil ideológico com perfil regional...",
  "Identificando zonas de risco...",
  "Gerando estratégia eleitoral híbrida...",
];

// ---------- Tipos ----------
interface Candidate { id: string; full_name: string; }

interface StateAnalysis {
  uf: string;
  region: Region;
  temperatura: string;
  electoral_strength: number;
  rejection_score: number;
  perfil_eleitor_dominante: string;
  dna_eleitoral: { tema: string; score: number }[];
  segmentos_voto: { segmento: string; score: number }[];
  penetracao: { capitais: number; cidades_medias: number; interior: number; rural_profundo: number };
  fragilidade: { titulo: string; descricao: string };
  crescimento: { titulo: string; descricao: string };
  riscos: { titulo: string; severidade: string }[];
  oportunidades: string[];
}

interface RegionSummary {
  region: Region;
  temperatura: string;
  regional_strength_score: number;
  rejection_score: number;
  percepcao: string;
}

interface RegionAggregate {
  region: Region;
  electoral_strength: number;
  rejection_score: number;
  percepcao: string;
  perfis: string[];
  temas: { tema: string; score: number }[];
  riscos: { titulo: string; severidade: string; uf: string }[];
  oportunidades: string[];
  ufs: string[];
}

interface AnalysisResult {
  national: {
    forca_nacional: number;
    melhor_uf: string;
    uf_risco: string;
    expansao_potencial: string;
    sintese: string;
  };
  regions: RegionSummary[];
  states: StateAnalysis[];
  generated_at: string;
}

// ---------- Helpers ----------
function temperatureFromStrength(strength: number, rejection: number): string {
  if (strength >= 60 && rejection < 45) return "Favorável";
  if (rejection >= 60) return "Hostil";
  if (Math.abs(strength - rejection) <= 15) return "Competitiva";
  return "Neutra";
}

function tempColor(t: string): string {
  const k = t.toLowerCase();
  if (k.includes("favor")) return "hsl(142 76% 36%)";
  if (k.includes("compet")) return "hsl(48 96% 53%)";
  if (k.includes("hostil")) return "hsl(0 84% 60%)";
  return "hsl(220 9% 60%)";
}

function tempBadge(t: string) {
  const k = t.toLowerCase();
  if (k.includes("favor")) return "bg-green-500/15 text-green-600 border-green-500/30";
  if (k.includes("compet")) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (k.includes("hostil")) return "bg-red-500/15 text-red-600 border-red-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}

function sevBadge(s: string) {
  const k = s.toLowerCase();
  if (k.includes("crít")) return "bg-red-600/20 text-red-700 border-red-600/40";
  if (k.includes("alta")) return "bg-red-500/15 text-red-600 border-red-500/30";
  if (k.includes("méd") || k.includes("med")) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}

function sevRank(s: string): number {
  const k = s.toLowerCase();
  if (k.includes("crít")) return 4;
  if (k.includes("alta")) return 3;
  if (k.includes("méd") || k.includes("med")) return 2;
  return 1;
}

// ---------- Loading ----------
function RegionalLoading({ progress, message }: { progress: number; message: string }) {
  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-primary/5">
      <CardContent className="py-12">
        <div className="max-w-md mx-auto space-y-6 text-center">
          <div className="relative w-16 h-16 mx-auto">
            <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
            <div className="relative w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Compass className="h-8 w-8 text-primary animate-spin-slow" />
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold mb-1">Radar regional em análise</h3>
            <p className="text-sm text-muted-foreground animate-fade-in" key={message}>{message}</p>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </CardContent>
    </Card>
  );
}

// ---------- Main ----------
export default function RegionalAnalysis() {
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateId, setCandidateId] = useState<string>("");
  const [period, setPeriod] = useState<PeriodKey>("30d");
  const [customRange, setCustomRange] = useState<DateRange | undefined>();
  const [customOpen, setCustomOpen] = useState(false);

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [loadMsg, setLoadMsg] = useState(LOADING_MESSAGES[0]);
  const [error, setError] = useState<string | null>(null);

    const [selectedUf, setSelectedUf] = useState<string>("SP");
  const [hoverUf, setHoverUf] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const [hoverRegion, setHoverRegion] = useState<Region | null>(null);
  const [detailMode, setDetailMode] = useState<"state" | "region">("state");

  // Loading animation
  useEffect(() => {
    if (!loading) {
      if (progress > 0) {
        setProgress(100);
        const t = setTimeout(() => setProgress(0), 400);
        return () => clearTimeout(t);
      }
      return;
    }
    setProgress(5);
    let i = 0;
    setLoadMsg(LOADING_MESSAGES[0]);
    const msgTick = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadMsg(LOADING_MESSAGES[i]);
    }, 1800);
    const tick = setInterval(() => {
      setProgress((p) => Math.min(p + Math.random() * 5 + 2, 92));
    }, 500);
    return () => { clearInterval(tick); clearInterval(msgTick); };
  }, [loading]); // eslint-disable-line

  // Load candidates
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name")
        .eq("user_id", user.id)
        .eq("status", "active")
        .order("full_name");
      const list = data ?? [];
      setCandidates(list);
      if (list.length && !candidateId) setCandidateId(list[0].id);
    })();
  }, [user]); // eslint-disable-line

  const periodPayload = useMemo(() => {
    if (period === "custom" && customRange?.from && customRange?.to) {
      return {
        period_label: "Personalizado",
        period_from: format(customRange.from, "yyyy-MM-dd"),
        period_to: format(customRange.to, "yyyy-MM-dd"),
      };
    }
    const map: Record<PeriodKey, string> = {
      "7d": "últimos 7 dias",
      "30d": "últimos 30 dias",
      "90d": "últimos 90 dias",
      "1y": "último ano",
      "custom": "personalizado",
    };
    return { period_label: map[period] };
  }, [period, customRange]);

  const runAnalysis = useCallback(async () => {
    if (!user || !candidateId) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke("regional-ai-analysis", {
        body: { candidate_id: candidateId, ...periodPayload },
      });
      if (invokeErr) throw invokeErr;
      if (data?.error) throw new Error(data.message || data.error);
      setAnalysis(data as AnalysisResult);
      toast.success("Análise regional pronta.");
    } catch (e) {
      console.error(e);
      const msg = (e as Error).message || "Falha ao gerar análise regional.";
      setError(msg);
      toast.error("A IA está indisponível. Toque em Tentar novamente.");
    } finally {
      setLoading(false);
    }
  }, [user, candidateId, periodPayload]);

  useEffect(() => {
    if (!candidateId) return;
    if (period === "custom" && !(customRange?.from && customRange?.to)) return;
    runAnalysis();
  }, [candidateId, period, customRange]); // eslint-disable-line

  const stateMap = useMemo(() => {
    const m: Record<string, StateAnalysis> = {};
    analysis?.states.forEach((s) => { m[s.uf] = s; });
    return m;
  }, [analysis]);

  const regionAggregates = useMemo(() => {
    const m: Record<Region, RegionAggregate> = {} as any;
    if (!analysis) return m;
    REGIONS.forEach((rg) => {
      const sts = analysis.states.filter((s) => UF_REGION[s.uf] === rg);
      const summary = analysis.regions.find((r) => r.region === rg);
      const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      const temas: Record<string, number[]> = {};
      sts.forEach((s) => s.temas_sensibilidade.forEach((t) => {
        (temas[t.tema] ||= []).push(t.score);
      }));
      const temasAgg = Object.entries(temas).map(([tema, arr]) => ({ tema, score: avg(arr) }))
        .sort((a, b) => b.score - a.score);
      const profiles = Array.from(new Set(sts.map((s) => s.perfil_eleitor_dominante).filter(Boolean))).slice(0, 4);
      const riscos = sts.flatMap((s) => s.riscos.map((r) => ({ ...r, uf: s.uf })))
        .sort((a, b) => sevRank(b.severidade) - sevRank(a.severidade)).slice(0, 5);
      const oportunidades = Array.from(new Set(sts.flatMap((s) => s.oportunidades))).slice(0, 6);
      m[rg] = {
        region: rg,
        electoral_strength: summary?.regional_strength_score || avg(sts.map((s) => s.electoral_strength)),
        rejection_score: summary?.rejection_score || avg(sts.map((s) => s.rejection_score)),
        percepcao: summary?.percepcao || "",
        perfis: profiles,
        temas: temasAgg,
        riscos,
        oportunidades,
        ufs: sts.map((s) => s.uf),
      };
    });
    return m;
  }, [analysis]);

  const currentState = stateMap[selectedUf];
  const currentRegion = selectedRegion ? regionAggregates[selectedRegion] : null;

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-6 animate-fade-in">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <MapPinned className="h-7 w-7 text-primary" />
              Análise Regional
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl">
              Inteligência política híbrida: macrorregiões e os 27 estados — perfil do eleitor, temas sensíveis, penetração e estratégia.
            </p>
          </div>
          <div className="min-w-[220px]">
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Candidato</label>
            <Select value={candidateId} onValueChange={setCandidateId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Period pills */}
        <div className="flex flex-wrap gap-2 items-center">
          {PERIODS.map((p) => (
            <Button
              key={p.key}
              variant={period === p.key ? "default" : "outline"}
              size="sm"
              onClick={() => {
                if (p.key === "custom") { setCustomOpen(true); setPeriod("custom"); }
                else setPeriod(p.key);
              }}
              className="rounded-full transition-all duration-300"
            >
              {p.key === "custom" && <CalendarRange className="h-3 w-3 mr-1" />}
              {p.label}
              {p.key === "custom" && customRange?.from && customRange?.to && (
                <span className="ml-2 text-xs opacity-80">
                  {format(customRange.from, "dd/MM", { locale: ptBR })}–{format(customRange.to, "dd/MM", { locale: ptBR })}
                </span>
              )}
            </Button>
          ))}
        </div>

        {!candidateId && !loading && (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            Adicione um candidato em "Candidatos" para começar.
          </CardContent></Card>
        )}

        {loading && <RegionalLoading progress={progress} message={loadMsg} />}

        {!loading && error && !analysis && (
          <Card className="border-destructive/30 bg-destructive/5">
            <CardContent className="py-10 text-center space-y-3">
              <AlertTriangle className="h-8 w-8 text-destructive mx-auto" />
              <h3 className="font-semibold">A IA está temporariamente indisponível</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{error}</p>
              <Button onClick={runAnalysis}>Tentar novamente</Button>
            </CardContent>
          </Card>
        )}

        {!loading && analysis && (
          <>
            {/* National KPIs */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Radar Nacional</h2>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <KpiCard icon={<TrendingUp />} label="Força Nacional" value={`${analysis.national.forca_nacional}`} suffix="/100" tint="primary" />
                <KpiCard icon={<CheckCircle2 />} label="Melhor Estado" value={analysis.national.melhor_uf} sub={UF_NAMES[analysis.national.melhor_uf]} tint="green" onClick={() => setSelectedUf(analysis.national.melhor_uf)} />
                <KpiCard icon={<AlertTriangle />} label="Maior Risco" value={analysis.national.uf_risco} sub={UF_NAMES[analysis.national.uf_risco]} tint="red" onClick={() => setSelectedUf(analysis.national.uf_risco)} />
                <KpiCard icon={<Target />} label="Expansão Potencial" value={analysis.national.expansao_potencial} sub={UF_NAMES[analysis.national.expansao_potencial]} tint="blue" onClick={() => analysis.national.expansao_potencial && setSelectedUf(analysis.national.expansao_potencial)} />
              </div>
              {analysis.national.sintese && (
                <p className="text-sm text-muted-foreground mt-3 italic">{analysis.national.sintese}</p>
              )}
            </div>

            {/* Region map (5 macrorregiões) */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Compass className="h-5 w-5 text-primary" />
                <h2 className="text-xl font-semibold">Mapa Regional</h2>
                <span className="text-xs text-muted-foreground">5 macrorregiões — clique para detalhar</span>
              </div>
              <Card>
                <CardContent className="pt-5">
                  <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                    <div className="lg:col-span-2">
                      <svg viewBox={(BR_REGIONS_MAP as any).viewBox} className="w-full h-auto">
                        {REGIONS.map((rg) => {
                          const path = (BR_REGIONS_MAP as any).regions?.[rg];
                          if (!path) return null;
                          const agg = regionAggregates[rg];
                          const temp = agg ? temperatureFromStrength(agg.electoral_strength, agg.rejection_score) : "Neutra";
                          const fill = agg ? tempColor(temp) : "hsl(220 9% 75%)";
                          const isSel = selectedRegion === rg;
                          const isHover = hoverRegion === rg;
                          return (
                            <path
                              key={rg}
                              d={path}
                              fill={fill}
                              stroke={isSel ? "hsl(var(--primary))" : "hsl(var(--background))"}
                              strokeWidth={isSel ? 2 : 0.8}
                              opacity={isHover && !isSel ? 0.85 : 1}
                              className="cursor-pointer transition-all duration-300"
                              onClick={() => { setSelectedRegion(rg); setDetailMode("region"); }}
                              onMouseEnter={() => setHoverRegion(rg)}
                              onMouseLeave={() => setHoverRegion(null)}
                              style={{ filter: isSel ? "drop-shadow(0 0 8px hsl(var(--primary) / 0.55))" : undefined }}
                            >
                              <title>{rg} — Força {agg?.electoral_strength ?? 0} · Rejeição {agg?.rejection_score ?? 0}</title>
                            </path>
                          );
                        })}
                      </svg>
                    </div>
                    <div className="lg:col-span-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {REGIONS.map((rg) => {
                        const agg = regionAggregates[rg];
                        const temp = agg ? temperatureFromStrength(agg.electoral_strength, agg.rejection_score) : "Neutra";
                        const isSel = selectedRegion === rg;
                        return (
                          <button
                            key={rg}
                            onClick={() => { setSelectedRegion(rg); setDetailMode("region"); }}
                            className={cn(
                              "text-left p-3 rounded-lg border transition-all duration-300 hover:scale-[1.02]",
                              isSel ? "border-primary bg-primary/5" : "border-border bg-muted/30",
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-sm">{rg}</span>
                              <Badge className={cn("border text-[10px]", tempBadge(temp))}>{temp}</Badge>
                            </div>
                            <div className="flex gap-3 text-xs text-muted-foreground">
                              <span>Força <b className="text-foreground">{agg?.electoral_strength ?? 0}</b></span>
                              <span>Rejeição <b className="text-foreground">{agg?.rejection_score ?? 0}</b></span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Mapa por Estado (27 UFs) + detalhe */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Card className="lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MapPinned className="h-4 w-4 text-primary" /> Mapa por Estado
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <svg viewBox={BR_STATES_MAP.viewBox} className="w-full h-auto">
                    {Object.entries(BR_STATES_MAP.states).map(([uf, data]) => {
                      const s = stateMap[uf];
                      const temp = s ? temperatureFromStrength(s.electoral_strength, s.rejection_score) : "Neutra";
                      const fill = s ? tempColor(temp) : "hsl(220 9% 75%)";
                      const isSel = uf === selectedUf && detailMode === "state";
                      const isHover = uf === hoverUf;
                      return (
                        <path
                          key={uf}
                          d={(data as any).path}
                          fill={fill}
                          stroke={isSel ? "hsl(var(--primary))" : "hsl(var(--background))"}
                          strokeWidth={isSel ? 1.8 : 0.6}
                          opacity={isHover && !isSel ? 0.85 : 1}
                          className="cursor-pointer transition-all duration-300"
                          onClick={() => { setSelectedUf(uf); setDetailMode("state"); }}
                          onMouseEnter={() => setHoverUf(uf)}
                          onMouseLeave={() => setHoverUf(null)}
                          style={{ filter: isSel ? "drop-shadow(0 0 6px hsl(var(--primary) / 0.55))" : undefined }}
                        >
                          <title>{UF_NAMES[uf]} — Força {s?.electoral_strength ?? 0} · Rejeição {s?.rejection_score ?? 0}</title>
                        </path>
                      );
                    })}
                  </svg>
                  <div className="flex flex-wrap gap-2 mt-3 text-xs">
                    <Legend color="hsl(142 76% 36%)" label="Favorável" />
                    <Legend color="hsl(48 96% 53%)" label="Competitivo" />
                    <Legend color="hsl(0 84% 60%)" label="Desfavorável" />
                    <Legend color="hsl(220 9% 60%)" label="Neutro" />
                  </div>
                </CardContent>
              </Card>

              <div className="lg:col-span-3 transition-all duration-300" key={`${detailMode}-${detailMode === "state" ? selectedUf : selectedRegion}`}>
                {detailMode === "region" && currentRegion ? (
                  <RegionPanel data={currentRegion} onPickUf={(uf) => { setSelectedUf(uf); setDetailMode("state"); }} />
                ) : currentState ? (
                  <StatePanel data={currentState} />
                ) : (
                  <Card><CardContent className="py-10 text-center text-muted-foreground">
                    Selecione um estado ou região no mapa.
                  </CardContent></Card>
                )}
              </div>
            </div>
          </>
        )}

        {/* Custom date dialog */}
        <Dialog open={customOpen} onOpenChange={setCustomOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Período personalizado</DialogTitle></DialogHeader>
            <Calendar
              mode="range"
              selected={customRange}
              onSelect={setCustomRange}
              numberOfMonths={1}
              locale={ptBR}
              className={cn("p-3 pointer-events-auto rounded-md border")}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCustomOpen(false)}>Cancelar</Button>
              <Button
                onClick={() => { setCustomOpen(false); setPeriod("custom"); }}
                disabled={!(customRange?.from && customRange?.to)}
              >
                Aplicar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

// ---------- Subcomponents ----------
function KpiCard({ icon, label, value, sub, suffix, tint, onClick }: { icon: React.ReactNode; label: string; value: string; sub?: string; suffix?: string; tint: "primary" | "green" | "red" | "blue"; onClick?: () => void }) {
  const colors = {
    primary: "from-primary/10 to-primary/5 text-primary",
    green: "from-green-500/10 to-green-500/5 text-green-600",
    red: "from-red-500/10 to-red-500/5 text-red-600",
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
  }[tint];
  return (
    <Card
      className={cn("bg-gradient-to-br border-0 transition-all duration-300", colors, onClick && "cursor-pointer hover:scale-[1.02]")}
      onClick={onClick}
    >
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs font-medium opacity-80 mb-2">
          <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {label}
        </div>
        <div className="text-2xl font-bold text-foreground">
          {value}
          {suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color }} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function StatePanel({ data }: { data: StateAnalysis }) {
  const temp = temperatureFromStrength(data.electoral_strength, data.rejection_score);
  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                {UF_NAMES[data.uf]} <Badge variant="outline" className="text-xs">{data.uf}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Região {UF_REGION[data.uf]}</p>
            </div>
            <Badge className={cn("border", tempBadge(temp))}>{temp}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <ScorePill label="Força eleitoral" value={data.electoral_strength} positive />
            <ScorePill label="Rejeição" value={data.rejection_score} />
          </div>
        </CardContent>
      </Card>

      <SectionCard icon={<Users className="h-4 w-4 text-primary" />} title="Perfil do eleitor dominante">
        <p className="text-sm leading-relaxed">{data.perfil_eleitor_dominante}</p>
      </SectionCard>

      <SectionCard icon={<Sparkles className="h-4 w-4 text-amber-500" />} title="Sensibilidade temática">
        <div className="space-y-2">
          {data.temas_sensibilidade.map((t) => (
            <div key={t.tema} className="flex items-center gap-3">
              <span className="text-xs w-28 text-muted-foreground">{TEMA_LABELS[t.tema] || t.tema}</span>
              <Progress value={t.score} className="h-2 flex-1" />
              <span className="text-xs font-medium w-10 text-right tabular-nums">{t.score}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<Building2 className="h-4 w-4 text-blue-600" />} title="Penetração eleitoral">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <PenCell label="Capitais" value={data.penetracao.capitais} />
          <PenCell label="Cidades médias" value={data.penetracao.cidades_medias} />
          <PenCell label="Interior" value={data.penetracao.interior} />
          <PenCell label="Rural profundo" value={data.penetracao.rural_profundo} />
        </div>
      </SectionCard>

      <SectionCard icon={<ShieldAlert className="h-4 w-4 text-amber-600" />} title="Riscos">
        <div className="space-y-2">
          {data.riscos.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40">
              <span className="text-sm">{r.titulo}</span>
              <Badge className={cn("border text-xs", sevBadge(r.severidade))}>{r.severidade}</Badge>
            </div>
          ))}
          {!data.riscos.length && <p className="text-sm text-muted-foreground">Sem riscos relevantes mapeados.</p>}
        </div>
      </SectionCard>

      <SectionCard icon={<Lightbulb className="h-4 w-4 text-primary" />} title="Oportunidades">
        {data.oportunidades.length ? (
          <ul className="space-y-1.5">
            {data.oportunidades.map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0 bg-primary" />
                <span className="leading-relaxed">{o}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Sem oportunidades mapeadas.</p>}
      </SectionCard>
    </div>
  );
}

function ScorePill({ label, value, positive }: { label: string; value: number; positive?: boolean }) {
  const color = positive
    ? (value >= 65 ? "text-green-600" : value >= 40 ? "text-amber-600" : "text-red-600")
    : (value >= 65 ? "text-red-600" : value >= 40 ? "text-amber-600" : "text-green-600");
  return (
    <div className="p-3 rounded-lg bg-muted/40">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-bold", color)}>{value}<span className="text-sm text-muted-foreground ml-1">/100</span></div>
      <Progress value={value} className="h-1.5 mt-1" />
    </div>
  );
}

function PenCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-3 rounded-lg bg-muted/40">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}<span className="text-xs text-muted-foreground ml-1">/100</span></div>
      <Progress value={value} className="h-1 mt-1" />
    </div>
  );
}

function SectionCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function RegionPanel({ data, onPickUf }: { data: RegionAggregate; onPickUf: (uf: string) => void }) {
  const temp = temperatureFromStrength(data.electoral_strength, data.rejection_score);
  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Compass className="h-5 w-5 text-primary" /> Região {data.region}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{data.ufs.length} estados nesta região</p>
            </div>
            <Badge className={cn("border", tempBadge(temp))}>{temp}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <ScorePill label="Força regional" value={data.electoral_strength} positive />
            <ScorePill label="Rejeição regional" value={data.rejection_score} />
          </div>
          {data.percepcao && (
            <p className="text-sm leading-relaxed text-muted-foreground italic border-l-2 border-primary/40 pl-3">
              {data.percepcao}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {data.ufs.map((uf) => (
              <Badge key={uf} variant="outline" className="text-xs cursor-pointer hover:bg-primary/10"
                onClick={() => onPickUf(uf)}>
                {uf}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {data.perfis.length > 0 && (
        <SectionCard icon={<Users className="h-4 w-4 text-primary" />} title="Perfis de eleitor dominantes">
          <ul className="space-y-1.5">
            {data.perfis.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0 bg-primary" />
                <span className="leading-relaxed">{p}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <SectionCard icon={<Sparkles className="h-4 w-4 text-amber-500" />} title="Temas dominantes na região">
        <div className="space-y-2">
          {data.temas.map((t) => (
            <div key={t.tema} className="flex items-center gap-3">
              <span className="text-xs w-28 text-muted-foreground">{TEMA_LABELS[t.tema] || t.tema}</span>
              <Progress value={t.score} className="h-2 flex-1" />
              <span className="text-xs font-medium w-10 text-right tabular-nums">{t.score}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard icon={<ShieldAlert className="h-4 w-4 text-amber-600" />} title="Riscos regionais">
        <div className="space-y-2">
          {data.riscos.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40">
              <span className="text-sm flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">{r.uf}</Badge>
                {r.titulo}
              </span>
              <Badge className={cn("border text-xs", sevBadge(r.severidade))}>{r.severidade}</Badge>
            </div>
          ))}
          {!data.riscos.length && <p className="text-sm text-muted-foreground">Sem riscos relevantes mapeados.</p>}
        </div>
      </SectionCard>

      <SectionCard icon={<Lightbulb className="h-4 w-4 text-primary" />} title="Oportunidades eleitorais">
        {data.oportunidades.length ? (
          <ul className="space-y-1.5">
            {data.oportunidades.map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="w-1.5 h-1.5 rounded-full mt-2 shrink-0 bg-primary" />
                <span className="leading-relaxed">{o}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Sem oportunidades mapeadas.</p>}
      </SectionCard>
    </div>
  );
}
