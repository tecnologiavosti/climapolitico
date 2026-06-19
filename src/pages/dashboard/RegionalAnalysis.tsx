import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import {
  MapPinned, Sparkles, TrendingUp, AlertTriangle, Target, Users, UserX,
  Lightbulb, MessageCircle, ShieldAlert, CheckCircle2, XCircle, Compass,
  CalendarRange,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { BR_MAP } from "@/data/brRegionsMap";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
type Region = typeof REGIONS[number];

const REGION_PATHS = BR_MAP.regions as Record<Region, string>;
const REGION_LABELS = BR_MAP.labels as Record<Region, { x: number; y: number }>;
const MAP_VIEWBOX = BR_MAP.viewBox;

interface Candidate { id: string; full_name: string; }

interface RegionAnalysis {
  region: Region;
  temperatura: string;
  regional_strength_score: number;
  rejection_score: number;
  percepcao: string;
  temas: { nome: string; intensidade: string }[];
  apoia: string[];
  rejeita: string[];
  riscos: { titulo: string; severidade: string }[];
  oportunidades: string[];
  narrativas_funcionam: string[];
  narrativas_falham: string[];
  recomendacoes: string[];
}
interface AnalysisResult {
  national: {
    forca_nacional: number;
    melhor_regiao: Region;
    regiao_risco: Region;
    expansao_potencial: Region;
    sintese: string;
  };
  regions: RegionAnalysis[];
  generated_at: string;
  fallback?: boolean;
}

type PeriodKey = "7d" | "30d" | "90d" | "1y" | "custom";

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
  { key: "1y", label: "1 ano" },
  { key: "custom", label: "Personalizado" },
];

const LOADING_MESSAGES = [
  "Analisando percepção regional...",
  "Mapeando forças eleitorais...",
  "Identificando zonas de risco...",
  "Gerando estratégia regional...",
  "Cruzando perfil ideológico com regiões...",
];

function scoreColor(score: number): string {
  if (score >= 65) return "hsl(142 76% 36%)"; // verde
  if (score >= 45) return "hsl(48 96% 53%)"; // amarelo
  if (score >= 25) return "hsl(0 84% 60%)"; // vermelho
  return "hsl(var(--muted))";
}

function temperatureBadge(t: string) {
  const k = t.toLowerCase();
  if (k.includes("favor")) return "bg-green-500/15 text-green-600 border-green-500/30";
  if (k.includes("compet")) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (k.includes("hostil")) return "bg-red-500/15 text-red-600 border-red-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}

function severityBadge(s: string) {
  const k = s.toLowerCase();
  if (k.includes("crít")) return "bg-red-600/20 text-red-700 border-red-600/40";
  if (k.includes("alta")) return "bg-red-500/15 text-red-600 border-red-500/30";
  if (k.includes("méd") || k.includes("med")) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-slate-500/15 text-slate-600 border-slate-500/30";
}

function intensityBadge(i: string) {
  const k = i.toLowerCase();
  if (k.includes("alta")) return "bg-primary/15 text-primary border-primary/30";
  if (k.includes("méd") || k.includes("med")) return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  return "bg-muted text-muted-foreground border-border";
}

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
  const [selectedRegion, setSelectedRegion] = useState<Region>("Sudeste");
  const [regionPulse, setRegionPulse] = useState(0);

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
      setProgress((p) => Math.min(p + Math.random() * 6 + 2, 92));
    }, 400);
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

  const [error, setError] = useState<string | null>(null);

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
      setRegionPulse((n) => n + 1);
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

  const currentRegion = useMemo(
    () => analysis?.regions.find((r) => r.region === selectedRegion),
    [analysis, selectedRegion]
  );

  const regionScores = useMemo(() => {
    const m = {} as Record<Region, number>;
    for (const r of REGIONS) m[r] = analysis?.regions.find((x) => x.region === r)?.regional_strength_score ?? 0;
    return m;
  }, [analysis]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MapPinned className="h-7 w-7 text-primary" />
            Análise Regional
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Inteligência estratégica IA: como o candidato é percebido em cada região do Brasil — temas, apoios, riscos e narrativas.
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
            className="rounded-full"
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
              <h2 className="text-xl font-semibold">Radar Regional Nacional</h2>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <KpiCard icon={<TrendingUp />} label="Força Nacional" value={`${analysis.national.forca_nacional}`} suffix="/100" tint="primary" />
              <KpiCard icon={<CheckCircle2 />} label="Melhor Região" value={analysis.national.melhor_regiao} tint="green" />
              <KpiCard icon={<AlertTriangle />} label="Maior Risco" value={analysis.national.regiao_risco} tint="red" />
              <KpiCard icon={<Target />} label="Expansão Potencial" value={analysis.national.expansao_potencial} tint="blue" />
            </div>
            {analysis.national.sintese && (
              <p className="text-sm text-muted-foreground mt-3 italic">{analysis.national.sintese}</p>
            )}
          </div>

          {/* Map + Region detail */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPinned className="h-4 w-4 text-primary" /> Mapa de força regional
                </CardTitle>
              </CardHeader>
              <CardContent>
                <svg viewBox={MAP_VIEWBOX} className="w-full h-auto">
                  {REGIONS.map((r) => {
                    const isSel = r === selectedRegion;
                    const fill = scoreColor(regionScores[r] ?? 0);
                    return (
                      <path
                        key={r}
                        d={REGION_PATHS[r]}
                        fill={fill}
                        stroke={isSel ? "hsl(var(--primary))" : "hsl(var(--background))"}
                        strokeWidth={isSel ? 2.5 : 1}
                        className="cursor-pointer transition-all hover:opacity-80"
                        onClick={() => setSelectedRegion(r)}
                        style={{ filter: isSel ? "drop-shadow(0 0 8px hsl(var(--primary) / 0.5))" : undefined }}
                      />
                    );
                  })}
                  {REGIONS.map((r) => {
                    const p = REGION_LABELS[r];
                    if (!p) return null;
                    return (
                      <text key={`l-${r}`} x={p.x} y={p.y} textAnchor="middle"
                        className="pointer-events-none fill-white font-semibold text-[18px]"
                        style={{ paintOrder: "stroke", stroke: "rgba(0,0,0,0.4)", strokeWidth: 3 }}>
                        {r}
                      </text>
                    );
                  })}
                </svg>
                <div className="flex flex-wrap gap-2 mt-3 text-xs">
                  <Legend color="hsl(142 76% 36%)" label="Favorável" />
                  <Legend color="hsl(48 96% 53%)" label="Competitiva" />
                  <Legend color="hsl(0 84% 60%)" label="Desfavorável" />
                  <Legend color="hsl(var(--muted))" label="Neutra" />
                </div>
              </CardContent>
            </Card>

            <div className="lg:col-span-3" key={`${selectedRegion}-${regionPulse}`}>
              {currentRegion && <RegionPanel data={currentRegion} />}
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
  );
}

function KpiCard({ icon, label, value, suffix, tint }: { icon: React.ReactNode; label: string; value: string; suffix?: string; tint: "primary" | "green" | "red" | "blue" }) {
  const colors = {
    primary: "from-primary/10 to-primary/5 text-primary",
    green: "from-green-500/10 to-green-500/5 text-green-600",
    red: "from-red-500/10 to-red-500/5 text-red-600",
    blue: "from-blue-500/10 to-blue-500/5 text-blue-600",
  }[tint];
  return (
    <Card className={cn("bg-gradient-to-br border-0", colors)}>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-xs font-medium opacity-80 mb-2">
          <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {label}
        </div>
        <div className="text-2xl font-bold text-foreground">
          {value}
          {suffix && <span className="text-sm text-muted-foreground ml-1">{suffix}</span>}
        </div>
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

function RegionPanel({ data }: { data: RegionAnalysis }) {
  return (
    <div className="space-y-4 animate-fade-in">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">{data.region}</CardTitle>
            <Badge className={cn("border", temperatureBadge(data.temperatura))}>{data.temperatura}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <ScorePill label="Força regional" value={data.regional_strength_score} positive />
            <ScorePill label="Rejeição regional" value={data.rejection_score} />
          </div>
          {data.percepcao && (
            <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/30 pl-3">
              {data.percepcao}
            </p>
          )}
        </CardContent>
      </Card>

      <SectionCard icon={<MessageCircle className="h-4 w-4" />} title="Temas dominantes">
        <div className="flex flex-wrap gap-2">
          {data.temas.map((t, i) => (
            <Badge key={i} variant="outline" className={cn("border", intensityBadge(t.intensidade))}>
              {t.nome} · {t.intensidade}
            </Badge>
          ))}
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard icon={<Users className="h-4 w-4 text-green-600" />} title="Quem apoia">
          <Bullets items={data.apoia} tone="green" />
        </SectionCard>
        <SectionCard icon={<UserX className="h-4 w-4 text-red-600" />} title="Quem rejeita">
          <Bullets items={data.rejeita} tone="red" />
        </SectionCard>
      </div>

      <SectionCard icon={<ShieldAlert className="h-4 w-4 text-amber-600" />} title="Riscos regionais">
        <div className="space-y-2">
          {data.riscos.map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40">
              <span className="text-sm">{r.titulo}</span>
              <Badge className={cn("border text-xs", severityBadge(r.severidade))}>{r.severidade}</Badge>
            </div>
          ))}
          {!data.riscos.length && <p className="text-sm text-muted-foreground">Sem riscos relevantes mapeados.</p>}
        </div>
      </SectionCard>

      <SectionCard icon={<Target className="h-4 w-4 text-blue-600" />} title="Oportunidades regionais">
        <Bullets items={data.oportunidades} tone="blue" />
      </SectionCard>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard icon={<CheckCircle2 className="h-4 w-4 text-green-600" />} title="Narrativas que funcionam">
          <Bullets items={data.narrativas_funcionam} tone="green" quote />
        </SectionCard>
        <SectionCard icon={<XCircle className="h-4 w-4 text-red-600" />} title="Narrativas que falham">
          <Bullets items={data.narrativas_falham} tone="red" quote />
        </SectionCard>
      </div>

      <SectionCard icon={<Lightbulb className="h-4 w-4 text-primary" />} title="Recomendações de campanha">
        <ol className="space-y-2 list-decimal list-inside">
          {data.recomendacoes.map((r, i) => (
            <li key={i} className="text-sm leading-relaxed">{r}</li>
          ))}
        </ol>
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

function Bullets({ items, tone, quote }: { items: string[]; tone: "green" | "red" | "blue"; quote?: boolean }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Sem dados.</p>;
  const dot = { green: "bg-green-500", red: "bg-red-500", blue: "bg-blue-500" }[tone];
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm">
          <span className={cn("w-1.5 h-1.5 rounded-full mt-2 shrink-0", dot)} />
          <span className="leading-relaxed">{quote ? `“${it}”` : it}</span>
        </li>
      ))}
    </ul>
  );
}
