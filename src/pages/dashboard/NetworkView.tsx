import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DateRange } from "react-day-picker";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { DateRangePicker } from "@/components/DateRangePicker";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { CandidateSelector } from "@/components/dashboard/realtime/CandidateSelector";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  BarChart3,
  BrainCircuit,
  CheckCircle2,
  ChevronsUpDown,
  Flame,
  Gauge,
  Loader2,
  Megaphone,
  MessageCircle,
  Play,
  RefreshCw,
  Repeat2,
  Share2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Users,
  Zap,
} from "lucide-react";


type ClimaStatus = "explodindo" | "aquecido" | "estavel" | "frio" | "hostil" | "favoravel" | "polarizado";
type Tracao = "alta" | "media" | "baixa";
type Viralizacao = "alta" | "media" | "baixa";

interface ListeningReport {
  clima_social: { status: ClimaStatus[]; headline: string; texto: string };
  reacao_da_rede: { texto: string; sinais: string[] };
  formatos_que_engajam: {
    alta_tracao: string[];
    media_tracao: string[];
    baixa_tracao: string[];
  };
  narrativas_dominantes: {
    positivas: string[];
    negativas: string[];
    neutras: string[];
  };
  comentarios_tipicos: Array<{ texto: string; tom: "apoio" | "critica" | "neutro" | "ironia" }>;
  amplificadores: Array<{ categoria: string; papel: string; intensidade: Tracao }>;
  risco_viralizacao: Array<{ tema: string; nivel: Viralizacao; motivo: string }>;
  score_performance_social: {
    viralizacao: number;
    aprovacao: number;
    rejeicao: number;
    engajamento: number;
    shareability: number;
    meme_potential: number;
  };
  network: string;
  period: { start: string; end: string };
  evidence_used: number;
  generated_at: string;
}

const NETWORK_OPTIONS = [
  { value: "instagram", label: "Instagram" },
  { value: "twitter", label: "X / Twitter" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "facebook", label: "Facebook" },
  { value: "googletrends", label: "Google Trends" },
];

const NETWORKS_FILTER = [
  { value: "all", label: "Todas" },
  ...NETWORK_OPTIONS,
];

const PROGRESS_STEPS = [
  "Inicializando",
  "Coletando posts e menções",
  "Calculando engajamento",
  "Calculando sentimento",
  "Calculando viralização",
  "Gerando insights IA",
];

const PERIODS = [
  { value: "7", label: "7 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
  { value: "365", label: "1 ano" },
  { value: "custom", label: "Personalizado" },
] as const;


const STATUS_META: Record<ClimaStatus, { label: string; cls: string }> = {
  explodindo: { label: "Explodindo", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  aquecido: { label: "Aquecido", cls: "bg-primary/15 text-primary border-primary/40" },
  estavel: { label: "Estável", cls: "bg-muted text-muted-foreground border-border" },
  frio: { label: "Frio", cls: "bg-secondary text-secondary-foreground border-border" },
  hostil: { label: "Hostil", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  favoravel: { label: "Favorável", cls: "bg-success/15 text-success border-success/40" },
  polarizado: { label: "Polarizado", cls: "bg-accent/15 text-accent-foreground border-accent/40" },
};

const VIRAL_META: Record<Viralizacao, { label: string; icon: ReactNode; cls: string }> = {
  alta: { label: "Alta chance", icon: "🔥", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  media: { label: "Média chance", icon: "⚠️", cls: "bg-accent/15 text-accent-foreground border-accent/40" },
  baixa: { label: "Baixa chance", icon: "✓", cls: "bg-success/15 text-success border-success/40" },
};

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value || 0)));

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>(NETWORK_OPTIONS.map((n) => n.value));
  const [selectedId, setSelectedId] = useState<string>("");
  const [activeCandidateId, setActiveCandidateId] = useState<string>("");
  const [started, setStarted] = useState(false);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["value"]>("30");
  const [customRange, setCustomRange] = useState<DateRange | undefined>({
    from: new Date(new Date().setDate(new Date().getDate() - 30)),
    to: new Date(),
  });
  const [nonce, setNonce] = useState(0);
  const [progressStep, setProgressStep] = useState(0);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const range = useMemo(() => {
    if (period === "custom") {
      if (!customRange?.from || !customRange?.to) return null;
      return { start_date: toIsoDate(customRange.from), end_date: toIsoDate(customRange.to) };
    }
    const end = new Date();
    const start = new Date(end.getTime() - Number(period) * 86_400_000);
    return { start_date: toIsoDate(start), end_date: toIsoDate(end) };
  }, [customRange, period]);

  const { data: candidates } = useQuery({
    queryKey: ["nv-candidates", user?.id, isAdmin],
    queryFn: async () => {
      let q = supabase.from("candidates").select("id, full_name, party, region").eq("status", "active");
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      const { data, error } = await q.order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const selectedCandidate = useMemo(
    () => candidates?.find((c: any) => c.id === selectedId),
    [candidates, selectedId],
  );
  const activeCandidate = useMemo(
    () => candidates?.find((c: any) => c.id === activeCandidateId),
    [candidates, activeCandidateId],
  );

  // Network sent to backend: single string if 1 selected, else "all".
  const networkParam = selectedNetworks.length === 1 ? selectedNetworks[0] : "all";

  const analysis = useQuery({
    queryKey: ["nv-social-listening-v4", activeCandidateId, networkParam, range?.start_date, range?.end_date, nonce],
    enabled: started && !!activeCandidate && !!range,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("network-qualitative-analysis", {
        body: {
          candidate_name: (activeCandidate as any).full_name,
          party: (activeCandidate as any).party ?? null,
          region: (activeCandidate as any).region ?? null,
          network: networkParam,
          start_date: range!.start_date,
          end_date: range!.end_date,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message ?? (data as any).error);
      return (data as any).report as ListeningReport;
    },
  });

  const report = analysis.data;
  const loading = analysis.isFetching;

  // Drive progress steps while loading
  useEffect(() => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    if (loading) {
      setProgressStep(0);
      progressTimerRef.current = setInterval(() => {
        setProgressStep((s) => (s < PROGRESS_STEPS.length - 1 ? s + 1 : s));
      }, 1600);
    } else if (report) {
      setProgressStep(PROGRESS_STEPS.length);
    }
    return () => { if (progressTimerRef.current) clearInterval(progressTimerRef.current); };
  }, [loading, report]);

  const handleStart = () => {
    if (!selectedCandidate) return;
    setActiveCandidateId(selectedCandidate.id);
    setStarted(true);
    setNonce((n) => n + 1);
  };

  const handleChangeCandidate = () => {
    setStarted(false);
    setActiveCandidateId("");
    setProgressStep(0);
    analysis.remove?.();
  };

  const toggleNetwork = (val: string) => {
    setSelectedNetworks((prev) =>
      prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
    );
  };
  const networksLabel = selectedNetworks.length === 0
    ? "Nenhuma rede"
    : selectedNetworks.length === NETWORK_OPTIONS.length
      ? "Todas as redes"
      : selectedNetworks.length === 1
        ? NETWORK_OPTIONS.find((n) => n.value === selectedNetworks[0])?.label ?? "1 rede"
        : `${selectedNetworks.length} redes`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Como este candidato existe dentro das redes sociais?
          </p>
          {started && report && (
            <p className="text-xs text-muted-foreground font-medium">
              Período: {format(new Date(report.period.start), "dd/MM/yyyy")} até {format(new Date(report.period.end), "dd/MM/yyyy")}
            </p>
          )}
        </div>

        {started && activeCandidate && (
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-[11px] text-muted-foreground">Análise social ativa para</div>
            <div className="text-sm font-semibold">{(activeCandidate as any).full_name}</div>
            {report && (
              <div className="text-[10px] text-muted-foreground">
                Última atualização: {format(new Date(report.generated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
              </div>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)} disabled={loading || !range}>
                <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
                Atualizar IA
              </Button>
              <Button size="sm" variant="ghost" onClick={handleChangeCandidate} disabled={loading}>
                <Users className="h-4 w-4 mr-1.5" />
                Trocar candidato
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Initial start screen */}
      {!started && (
        <Card className="border-border/60">
          <CardContent className="p-8 flex flex-col items-center gap-4 max-w-2xl mx-auto text-center">
            <div className="rounded-full bg-primary/10 p-3">
              <BrainCircuit className="h-6 w-6 text-primary" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold">Selecione um candidato para iniciar</h2>
              <p className="text-xs text-muted-foreground">
                A IA irá coletar posts, menções, engajamento, sentimento e viralização nas redes escolhidas.
              </p>
            </div>
            <div className="w-full max-w-md space-y-2">
              <CandidateSelector
                candidates={(candidates || []) as any}
                value={selectedId}
                onChange={setSelectedId}
                disabled={loading}
              />

              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-between h-11 bg-card/60">
                    <span className="text-sm truncate">{networksLabel}</span>
                    <ChevronsUpDown className="h-4 w-4 text-muted-foreground opacity-70" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
                  <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-border/60">
                    <span className="text-xs font-medium text-muted-foreground">Redes</span>
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      onClick={() =>
                        setSelectedNetworks(
                          selectedNetworks.length === NETWORK_OPTIONS.length ? [] : NETWORK_OPTIONS.map((n) => n.value)
                        )
                      }
                    >
                      {selectedNetworks.length === NETWORK_OPTIONS.length ? "Limpar" : "Selecionar todas"}
                    </button>
                  </div>
                  <div className="space-y-0.5">
                    {NETWORK_OPTIONS.map((n) => (
                      <label
                        key={n.value}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedNetworks.includes(n.value)}
                          onCheckedChange={() => toggleNetwork(n.value)}
                        />
                        <span className="text-sm">{n.label}</span>
                      </label>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <div className="flex flex-wrap justify-center gap-1">
                {PERIODS.map((p) => (
                  <Button
                    key={p.value}
                    type="button"
                    variant={period === p.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPeriod(p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>

              {period === "custom" && (
                <DateRangePicker dateRange={customRange} onDateRangeChange={setCustomRange} />
              )}

              <Button
                className="w-full"
                onClick={handleStart}
                disabled={!selectedCandidate || selectedNetworks.length === 0 || !range}
              >
                <Play className="h-4 w-4 mr-1.5" />
                Iniciar Análise Social IA
              </Button>
            </div>
            {(candidates?.length ?? 0) === 0 && (
              <p className="text-[11px] text-muted-foreground">
                Nenhum candidato cadastrado ainda. Adicione candidatos para começar.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {started && period === "custom" && !range && (
        <Card className="p-4 text-sm text-muted-foreground">Selecione data inicial e data final para usar o período personalizado.</Card>
      )}

      {started && analysis.isError && (
        <Card className="p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-destructive/40">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-sm text-destructive">Falha ao gerar análise</p>
              <p className="text-xs text-muted-foreground mt-1">{(analysis.error as Error)?.message ?? "erro desconhecido"}</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="h-4 w-4 mr-2" /> Tentar novamente
          </Button>
        </Card>
      )}

      {started && loading && !report && (
        <ProgressLoader steps={PROGRESS_STEPS} current={progressStep} />
      )}


      <AnimatePresence mode="wait">
        {started && report && (
          <motion.div
            key={`${activeCandidateId}-${networkParam}-${range?.start_date}-${range?.end_date}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className="space-y-8"
          >
            <ClimaSocialCard clima={report.clima_social} />
            <ReacaoRedeCard reacao={report.reacao_da_rede} network={report.network} />
            <FormatosCard formatos={report.formatos_que_engajam} />
            <NarrativasCard narrativas={report.narrativas_dominantes} />
            <ComentariosCard comentarios={report.comentarios_tipicos} />
            <AmplificadoresCard amplificadores={report.amplificadores} />
            <RiscoViralizacaoCard temas={report.risco_viralizacao} />
            <ScorePerformanceCard scores={report.score_performance_social} />

            <p className="text-xs text-muted-foreground">
              Leitura gerada por IA em {format(new Date(report.generated_at), "dd/MM/yyyy HH:mm")} ·
              {report.evidence_used > 0
                ? ` ${report.evidence_used} evidências web consultadas como contexto.`
                : " interpretação baseada em conhecimento político e padrões públicos de rede."}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

function ClimaSocialCard({ clima }: { clima: ListeningReport["clima_social"] }) {
  return (
    <Card className="p-6 space-y-4 border-primary/20">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold uppercase tracking-wide">Clima social da rede</h2>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {clima.status.map((s) => (
            <Badge key={s} variant="outline" className={`text-xs uppercase tracking-wider px-3 py-1 ${STATUS_META[s]?.cls ?? STATUS_META.estavel.cls}`}>
              {STATUS_META[s]?.label ?? s}
            </Badge>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xl font-bold">{clima.headline || "Clima social em leitura"}</p>
        <p className="text-sm leading-relaxed text-muted-foreground mt-2 whitespace-pre-line">{clima.texto || "—"}</p>
      </div>
    </Card>
  );
}

function ReacaoRedeCard({ reacao }: { reacao: ListeningReport["reacao_da_rede"]; network: string }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Repeat2 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Como a rede reage ao candidato</h2>
      </div>
      <p className="text-sm leading-relaxed">{reacao.texto || "—"}</p>
      {reacao.sinais.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {reacao.sinais.map((sinal, i) => (
            <div key={i} className="rounded-md border border-border bg-card/50 p-3 text-sm font-medium">
              {sinal}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function FormatosCard({ formatos }: { formatos: ListeningReport["formatos_que_engajam"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Zap className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Formatos que mais engajam</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <TractionBlock title="Alta tração" items={formatos.alta_tracao} tone="high" />
        <TractionBlock title="Média tração" items={formatos.media_tracao} tone="medium" />
        <TractionBlock title="Baixa tração" items={formatos.baixa_tracao} tone="low" />
      </div>
    </Card>
  );
}

function TractionBlock({ title, items, tone }: { title: string; items: string[]; tone: "high" | "medium" | "low" }) {
  const cls = tone === "high" ? "border-primary/35 bg-primary/5" : tone === "medium" ? "border-accent/35 bg-accent/5" : "border-muted bg-muted/25";
  return (
    <div className={`rounded-md border p-4 space-y-3 ${cls}`}>
      <div className="text-sm font-bold uppercase tracking-wider">{title}</div>
      <BulletList items={items} />
    </div>
  );
}

function NarrativasCard({ narrativas }: { narrativas: ListeningReport["narrativas_dominantes"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Narrativas dominantes</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <NarrativeColumn title="Positivas" items={narrativas.positivas} icon={<ThumbsUp className="h-4 w-4" />} tone="success" />
        <NarrativeColumn title="Negativas" items={narrativas.negativas} icon={<ThumbsDown className="h-4 w-4" />} tone="destructive" />
        <NarrativeColumn title="Neutras" items={narrativas.neutras} icon={<MessageCircle className="h-4 w-4" />} tone="neutral" />
      </div>
    </Card>
  );
}

function NarrativeColumn({ title, items, icon, tone }: { title: string; items: string[]; icon: ReactNode; tone: "success" | "destructive" | "neutral" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border p-4 bg-card/50 space-y-3">
      <div className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wider ${toneClass}`}>{icon}{title}</div>
      <BulletList items={items} />
    </div>
  );
}

function ComentariosCard({ comentarios }: { comentarios: ListeningReport["comentarios_tipicos"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Comentários típicos</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {comentarios.map((comentario, i) => (
          <div key={i} className="rounded-md border border-border bg-muted/25 p-4">
            <p className="text-sm leading-relaxed">“{comentario.texto}”</p>
            <Badge variant="secondary" className="mt-3 text-[11px] uppercase tracking-wider">{comentario.tom}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function AmplificadoresCard({ amplificadores }: { amplificadores: ListeningReport["amplificadores"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Megaphone className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Quem amplifica a narrativa</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {amplificadores.map((item, i) => (
          <div key={i} className="rounded-md border border-border p-4 bg-card/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="font-semibold text-sm">{item.categoria}</p>
              <Badge variant={item.intensidade === "alta" ? "default" : item.intensidade === "media" ? "secondary" : "outline"}>{item.intensidade}</Badge>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{item.papel}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function RiscoViralizacaoCard({ temas }: { temas: ListeningReport["risco_viralizacao"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Risco de viralização</h2>
      </div>
      <div className="space-y-2">
        {temas.map((t, i) => {
          const meta = VIRAL_META[t.nivel];
          return (
            <div key={i} className={`rounded-md border p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${meta.cls}`}>
              <div className="flex items-center gap-2 sm:min-w-[160px]">
                <span className="text-base">{meta.icon}</span>
                <span className="text-xs font-bold uppercase tracking-wider">{meta.label}</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold text-foreground">{t.tema}</div>
                {t.motivo && <div className="text-xs text-muted-foreground mt-0.5">{t.motivo}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ScorePerformanceCard({ scores }: { scores: ListeningReport["score_performance_social"] }) {
  const items = [
    { label: "Viralização", value: scores.viralizacao, icon: <Flame className="h-4 w-4" /> },
    { label: "Aprovação", value: scores.aprovacao, icon: <ThumbsUp className="h-4 w-4" /> },
    { label: "Rejeição", value: scores.rejeicao, icon: <ThumbsDown className="h-4 w-4" /> },
    { label: "Engajamento", value: scores.engajamento, icon: <Gauge className="h-4 w-4" /> },
    { label: "Shareability", value: scores.shareability, icon: <Share2 className="h-4 w-4" /> },
    { label: "Meme Potential", value: scores.meme_potential, icon: <Sparkles className="h-4 w-4" /> },
  ];

  return (
    <Card className="p-6 space-y-5 border-primary/20">
      <div className="flex items-center gap-2">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold uppercase tracking-wide">Score de performance social</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((item) => (
          <div key={item.label} className="rounded-md border border-border bg-card/50 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">{item.icon}{item.label}</div>
              <span className="text-2xl font-bold tabular-nums">{clamp(item.value)}</span>
            </div>
            <Progress value={clamp(item.value)} className="h-2" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <p className="text-xs text-muted-foreground italic">Nada relevante detectado.</p>;
  return (
    <ul className="space-y-2 text-sm leading-relaxed">
      {items.map((item, idx) => (
        <li key={idx} className="flex gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 text-primary shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}