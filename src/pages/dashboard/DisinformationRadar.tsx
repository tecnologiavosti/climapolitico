import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ShieldAlert,
  Loader2,
  Sparkles,
  AlertTriangle,
  Flame,
  Eye,
  Users,
  BookOpen,
  Megaphone,
  ShieldCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { cn } from "@/lib/utils";

type Period = "1" | "7" | "15" | "30" | "90";

const PERIODS: { value: Period; label: string }[] = [
  { value: "1", label: "24h" },
  { value: "7", label: "7 dias" },
  { value: "15", label: "15 dias" },
  { value: "30", label: "30 dias" },
  { value: "90", label: "90 dias" },
];

const LOADING_STEPS = [
  "Analisando padrões de desinformação...",
  "Consultando contexto político...",
  "Mapeando narrativas digitais...",
  "Gerando relatório estratégico...",
];

interface FakeItem {
  title: string;
  probability: number;
  explanation: string;
  likely_origin?: string;
}

interface Report {
  fake_news_count: number;
  reputational_risk: "Baixo" | "Médio" | "Alto" | "Crítico";
  attack_intensity: number;
  digital_vulnerability: "Baixa" | "Moderada" | "Alta" | "Crítica";
  executive_summary: string;
  fake_news_items: FakeItem[];
  how_to_identify: string[];
  how_to_respond: string[];
  narrative_categories: { category: string; intensity: number }[];
}

interface ApiResponse {
  candidate: { id: string; full_name: string; party: string; region: string };
  period: { daysBack: number; label: string };
  report: Report;
  totals?: { total: number; positive: number; negative: number; neutral: number };
  analysis_mode?: "data_driven" | "ai_research";
  signals?: { top_keywords: { word: string; count: number }[]; networks: any[]; regions: any[] };
  model_used: string;
  generated_at: string;
}

const riskColor: Record<string, string> = {
  Baixo: "text-emerald-500",
  Médio: "text-amber-500",
  Alto: "text-orange-500",
  Crítico: "text-red-500",
};
const vulnColor: Record<string, string> = {
  Baixa: "text-emerald-500",
  Moderada: "text-amber-500",
  Alta: "text-orange-500",
  Crítica: "text-red-500",
};

export default function DisinformationRadar() {
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [period, setPeriod] = useState<Period>("7");
  const navigate = useNavigate();

  const { data: candidates, isLoading: loadingCandidates } = useQuery({
    queryKey: ["candidates-for-disinfo"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data, error } = await supabase
        .from("candidates")
        .select("id, full_name, party, party_name, region")
        .eq("user_id", user.id)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Auto-select if only 1 candidate
  useEffect(() => {
    if (!selectedCandidate && candidates && candidates.length === 1) {
      setSelectedCandidate(candidates[0].id);
    }
  }, [candidates, selectedCandidate]);

  const [loadingStep, setLoadingStep] = useState(0);

  const mutation = useMutation({
    mutationFn: async () => {
      setLoadingStep(0);
      const start = Date.now();
      const steps = [900, 1800, 2700, 3600];
      const timers = steps.map((ms, i) => setTimeout(() => setLoadingStep(i + 1), ms));
      try {
        const [{ data, error }] = await Promise.all([
          supabase.functions.invoke("generate-disinformation-radar", {
            body: { candidateId: selectedCandidate, daysBack: parseInt(period) },
          }),
        ]);
        if (error) throw error;
        // Minimum visual time
        const elapsed = Date.now() - start;
        if (elapsed < 3800) await new Promise((r) => setTimeout(r, 3800 - elapsed));
        return data as ApiResponse;
      } finally {
        timers.forEach(clearTimeout);
        setLoadingStep(4);
      }
    },
    onError: (e: any) => {
      console.error(e);
      toast.error(e?.message || "Erro ao gerar análise");
    },
  });

  const report = mutation.data?.report;

  const chartData = useMemo(
    () =>
      report?.narrative_categories?.map((n) => ({
        name: n.category,
        Intensidade: n.intensity,
      })) ?? [],
    [report],
  );

  const handleGenerate = () => {
    if (!selectedCandidate) {
      toast.error("Selecione um candidato");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-red-500/20 to-orange-500/10 border border-red-500/30">
              <ShieldAlert className="h-6 w-6 text-red-500" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold">Radar de Desinformação</h1>
          </div>
          <p className="text-muted-foreground text-sm sm:text-base">
            Análise de fake news, narrativas manipuladas e riscos reputacionais via IA.
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card className="glass">
        <CardContent className="pt-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um candidato..." />
              </SelectTrigger>
              <SelectContent>
                {candidates?.map((c: any) => {
                  const initials = c.full_name.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase();
                  const subtitle = [c.party || c.party_name, c.region].filter(Boolean).join(" · ");
                  return (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold">
                          {initials}
                        </div>
                        <div className="flex flex-col text-left leading-tight">
                          <span className="font-semibold text-sm">{c.full_name}</span>
                          {subtitle && <span className="text-[11px] text-muted-foreground">{subtitle}</span>}
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Button
              onClick={handleGenerate}
              disabled={!selectedCandidate || mutation.isPending}
              className="bg-gradient-to-r from-red-500 to-orange-500 hover:opacity-90"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Gerando análise...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" /> Gerar análise IA
                </>
              )}
            </Button>
          </div>

          {/* Period chips */}
          <div className="flex flex-wrap gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-semibold transition-all border",
                  period === p.value
                    ? "bg-primary text-primary-foreground border-primary shadow-[0_0_18px_rgba(var(--primary-rgb,99,102,241),0.5)]"
                    : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Empty state — no candidates monitored */}
      {!loadingCandidates && candidates && candidates.length === 0 && (
        <Card className="glass">
          <CardContent className="py-12">
            <EmptyState
              icon={ShieldAlert}
              title="Nenhum candidato monitorado"
              description="Adicione um candidato para usar o Radar de Desinformação."
              action={{
                label: "Ir para catálogo",
                onClick: () => navigate("/dashboard/candidates-catalog"),
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Empty state — has candidates but none selected */}
      {candidates && candidates.length > 0 && !selectedCandidate && (
        <Card className="glass">
          <CardContent className="py-12">
            <EmptyState
              icon={ShieldAlert}
              title="Selecione um candidato"
              description="Selecione um candidato para analisar possíveis fake news e narrativas de desinformação."
            />
          </CardContent>
        </Card>
      )}

      <Dialog open={mutation.isPending} onOpenChange={() => undefined}>
        <DialogContent className="sm:max-w-lg overflow-hidden border-border/70 bg-card/95 backdrop-blur-xl p-0 [&>button]:hidden">
          <DialogTitle className="sr-only">Gerando análise estratégica de desinformação</DialogTitle>
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 animate-pulse" />
          <div className="p-7 sm:p-8 space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto relative h-16 w-16">
                <div className="absolute inset-0 rounded-full border border-red-500/25 animate-ping" />
                <div className="absolute inset-2 rounded-full bg-gradient-to-br from-red-500/20 to-orange-500/10 border border-red-500/30 flex items-center justify-center">
                  <ShieldAlert className="h-8 w-8 text-red-500" />
                </div>
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-bold">Radar estratégico em processamento</h3>
                <p className="text-sm text-muted-foreground min-h-5 transition-all duration-500">
                  {LOADING_STEPS[Math.min(loadingStep, LOADING_STEPS.length - 1)]}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 transition-all duration-700 ease-out"
                  style={{ width: `${Math.max(12, Math.min(100, ((loadingStep + 1) / LOADING_STEPS.length) * 100))}%` }}
                />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {LOADING_STEPS.map((label, i) => {
                  const done = loadingStep > i;
                  const active = loadingStep === i;
                  return (
                    <div
                      key={label}
                      className={cn(
                        "h-1 rounded-full transition-colors duration-500",
                        done || active ? "bg-orange-500" : "bg-muted",
                      )}
                    />
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              {LOADING_STEPS.map((label, i) => {
                const done = loadingStep > i;
                const active = loadingStep === i;
                return (
                  <div
                    key={label}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-300",
                      done && "bg-emerald-500/10",
                      active && "bg-orange-500/10",
                    )}
                  >
                    <div
                      className={cn(
                        "h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors",
                        done
                          ? "bg-emerald-500 text-primary-foreground"
                          : active
                          ? "bg-orange-500 text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? "✓" : active ? <Loader2 className="h-3 w-3 animate-spin" /> : i + 1}
                    </div>
                    <span className={cn("text-sm", active && "font-medium", !done && !active && "text-muted-foreground")}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Report */}
      {report && !mutation.isPending && (

        <>
          {/* Analysis mode badge */}
          {mutation.data?.analysis_mode && (
            <div className="flex justify-end">
              {mutation.data.analysis_mode === "data_driven" ? (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                  🟢 Baseado em dados reais ({mutation.data.totals?.total ?? 0} menções)
                </Badge>
              ) : (
                <Badge variant="outline" className="border-violet-500/40 text-violet-600 dark:text-violet-400 bg-violet-500/10">
                  🧠 Análise preditiva IA (baixo contexto)
                </Badge>
              )}
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">

            <Card className="glass hover-lift">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">Fake News Detectadas</p>
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                </div>
                <p className="text-3xl font-bold mt-2">{report.fake_news_count}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Possíveis narrativas falsas
                </p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">Risco Reputacional</p>
                  <Flame className="h-4 w-4 text-orange-500" />
                </div>
                <p className={cn("text-3xl font-bold mt-2 uppercase", riskColor[report.reputational_risk])}>
                  {report.reputational_risk}
                </p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">Intensidade de Ataques</p>
                  <Users className="h-4 w-4 text-amber-500" />
                </div>
                <p className="text-3xl font-bold mt-2">{report.attack_intensity}</p>
                <p className="text-[11px] text-muted-foreground mt-1">Score 0–100</p>
              </CardContent>
            </Card>
            <Card className="glass hover-lift">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground font-medium">Vulnerabilidade Digital</p>
                  <Eye className="h-4 w-4 text-indigo-500" />
                </div>
                <p className={cn("text-3xl font-bold mt-2", vulnColor[report.digital_vulnerability])}>
                  {report.digital_vulnerability}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Executive Summary */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" /> Resumo Executivo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">
                {report.executive_summary}
              </p>
            </CardContent>
          </Card>

          {/* Fake news items */}
          {report.fake_news_items?.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <AlertTriangle className="h-5 w-5 text-red-500" /> Possíveis Fake News
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.fake_news_items.map((f, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-lg border border-border/60 bg-muted/20 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold text-sm flex-1">"{f.title}"</p>
                      <Badge
                        variant={f.probability >= 75 ? "destructive" : "secondary"}
                        className="shrink-0"
                      >
                        {f.probability}%
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                      {f.explanation}
                    </p>
                    {f.likely_origin && (
                      <p className="text-[10px] text-primary/80 mt-1.5 font-medium">
                        Origem provável: {f.likely_origin}
                      </p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Narrative chart */}
          {chartData.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-lg">Intensidade por Categoria de Narrativa</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                      }}
                    />
                    <Bar dataKey="Intensidade" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Educação + Resposta */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BookOpen className="h-5 w-5 text-blue-500" />
                  Como identificar se isso é fake news?
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {report.how_to_identify?.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <ShieldCheck className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="glass">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Megaphone className="h-5 w-5 text-emerald-500" />
                  Como neutralizar essas narrativas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {report.how_to_respond?.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {mutation.data?.model_used && (
            <p className="text-[10px] text-muted-foreground text-right">
              Gerado por {mutation.data.model_used}
            </p>
          )}
        </>
      )}
    </div>
  );
}
