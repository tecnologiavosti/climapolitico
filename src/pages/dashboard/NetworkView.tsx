import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, RefreshCw, ThumbsUp, ThumbsDown, Minus, Hash, Tag,
  AlertTriangle, Lightbulb, MessageCircle, Radar as RadarIcon,
} from "lucide-react";
import { format } from "date-fns";

// ------------------------------------------------------------
// Visão por Rede Social — Análise Qualitativa por IA.
// Sem números absolutos de menções/interações. Apenas leitura
// interpretativa: resumo, sentimento %, narrativas, hashtags,
// termos e recomendações estratégicas.
// ------------------------------------------------------------

interface QualitativeReport {
  summary: string;
  sentiment: { positive: number; neutral: number; negative: number };
  narratives: { positive: string[]; negative: string[]; neutral: string[] };
  hashtags: string[];
  terms: {
    pessoas: string[];
    partidos: string[];
    estados: string[];
    instituicoes: string[];
    slogans: string[];
  };
  recommendations: { riscos: string[]; oportunidades: string[]; comunicacao: string[] };
  network: string;
  period: { start: string; end: string };
  evidence_used: number;
  generated_at: string;
}

const NETWORKS_FILTER = [
  { value: "all", label: "Todas as redes" },
  { value: "news", label: "Notícias" },
  { value: "youtube", label: "YouTube" },
  { value: "twitter", label: "X / Twitter" },
  { value: "telegram", label: "Telegram" },
  { value: "tiktok", label: "TikTok" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "reddit", label: "Reddit" },
];

const PERIODS = [
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" },
  { value: 365, label: "1 ano" },
];

const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);

export default function NetworkView() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [network, setNetwork] = useState("all");
  const [candidateId, setCandidateId] = useState<string>("all");
  const [days, setDays] = useState(30);
  const [nonce, setNonce] = useState(0);

  const range = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 86_400_000);
    return { start_date: toIsoDate(start), end_date: toIsoDate(end) };
  }, [days]);

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

  const candidate = useMemo(
    () => candidates?.find((c: any) => c.id === candidateId),
    [candidates, candidateId],
  );

  const analysis = useQuery({
    queryKey: ["nv-qualitative", candidateId, network, range.start_date, range.end_date, nonce],
    enabled: !!candidate,
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("network-qualitative-analysis", {
        body: {
          candidate_name: (candidate as any).full_name,
          party: (candidate as any).party ?? null,
          region: (candidate as any).region ?? null,
          network,
          start_date: range.start_date,
          end_date: range.end_date,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).message ?? (data as any).error);
      return (data as any).report as QualitativeReport;
    },
  });

  const report = analysis.data;
  const loading = analysis.isFetching;
  const needsCandidate = candidateId === "all";

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Análise qualitativa por IA — leitura interpretativa de como o candidato é percebido na rede selecionada.
          </p>
          {report && (
            <p className="text-xs text-muted-foreground mt-2 font-medium">
              Período: {format(new Date(report.period.start), "dd/MM/yyyy")} até {format(new Date(report.period.end), "dd/MM/yyyy")}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={candidateId} onValueChange={setCandidateId}>
            <SelectTrigger className="w-[200px]"><SelectValue placeholder="Candidato" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Selecione um candidato</SelectItem>
              {candidates?.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={network} onValueChange={setNetwork}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {NETWORKS_FILTER.map((n) => <SelectItem key={n.value} value={n.value}>{n.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-1">
            {PERIODS.map((p) => (
              <Button
                key={p.value}
                type="button"
                variant={days === p.value ? "default" : "outline"}
                size="sm"
                onClick={() => setDays(p.value)}
              >
                {p.label}
              </Button>
            ))}
          </div>
          {report && (
            <Button variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Reanalisar
            </Button>
          )}
        </div>
      </div>

      {needsCandidate && (
        <Card className="p-8 text-center">
          <RadarIcon className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-lg font-semibold mb-1">Selecione um candidato</h3>
          <p className="text-sm text-muted-foreground">
            Escolha um candidato para gerar a análise qualitativa por IA.
          </p>
        </Card>
      )}

      {!needsCandidate && analysis.isError && (
        <Card className="p-4 text-sm text-destructive flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span>Falha ao gerar análise: {(analysis.error as Error)?.message ?? "erro desconhecido"}</span>
          <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw className="h-4 w-4 mr-2" /> Tentar novamente
          </Button>
        </Card>
      )}

      {!needsCandidate && loading && !report && (
        <div className="space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!needsCandidate && report && (
        <>
          {/* 1. RESUMO EXECUTIVO */}
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Resumo executivo da rede</h2>
            </div>
            <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
              {report.summary || "—"}
            </p>
          </Card>

          {/* 2. SENTIMENTO GERAL */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Sentimento geral</h2>
            <div className="grid grid-cols-3 gap-4">
              <SentimentBlock label="Positivo" value={report.sentiment.positive} tone="success" icon={<ThumbsUp className="h-4 w-4" />} />
              <SentimentBlock label="Neutro" value={report.sentiment.neutral} tone="muted" icon={<Minus className="h-4 w-4" />} />
              <SentimentBlock label="Negativo" value={report.sentiment.negative} tone="destructive" icon={<ThumbsDown className="h-4 w-4" />} />
            </div>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${report.sentiment.positive}%`, backgroundColor: "hsl(var(--success))" }} />
              <div style={{ width: `${report.sentiment.neutral}%`, backgroundColor: "hsl(var(--muted-foreground))" }} />
              <div style={{ width: `${report.sentiment.negative}%`, backgroundColor: "hsl(var(--destructive))" }} />
            </div>
          </Card>

          {/* 3. NARRATIVAS DETECTADAS */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Narrativas detectadas</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <NarrativeColumn title="Positivas" items={report.narratives.positive} tone="success" icon={<ThumbsUp className="h-4 w-4" />} />
              <NarrativeColumn title="Neutras" items={report.narratives.neutral} tone="muted" icon={<Minus className="h-4 w-4" />} />
              <NarrativeColumn title="Negativas" items={report.narratives.negative} tone="destructive" icon={<ThumbsDown className="h-4 w-4" />} />
            </div>
          </Card>

          {/* 4. HASHTAGS EM ALTA */}
          <Card className="p-6 space-y-3">
            <div className="flex items-center gap-2">
              <Hash className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Hashtags em alta</h2>
            </div>
            {report.hashtags.length === 0 ? (
              <Empty />
            ) : (
              <div className="flex flex-wrap gap-2">
                {report.hashtags.map((h) => (
                  <Badge key={h} variant="secondary" className="text-sm py-1.5 px-3">{h}</Badge>
                ))}
              </div>
            )}
          </Card>

          {/* 5. TERMOS EM ALTA */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Termos em alta</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <TermGroup title="Pessoas" items={report.terms.pessoas} />
              <TermGroup title="Partidos" items={report.terms.partidos} />
              <TermGroup title="Estados" items={report.terms.estados} />
              <TermGroup title="Instituições" items={report.terms.instituicoes} />
              <TermGroup title="Slogans" items={report.terms.slogans} />
            </div>
          </Card>

          {/* 6. RECOMENDAÇÕES ESTRATÉGICAS */}
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-semibold">Recomendações estratégicas</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <RecommendationColumn title="Riscos" items={report.recommendations.riscos} tone="destructive" icon={<AlertTriangle className="h-4 w-4" />} />
              <RecommendationColumn title="Oportunidades" items={report.recommendations.oportunidades} tone="success" icon={<Lightbulb className="h-4 w-4" />} />
              <RecommendationColumn title="Comunicação" items={report.recommendations.comunicacao} tone="primary" icon={<MessageCircle className="h-4 w-4" />} />
            </div>
          </Card>

          <p className="text-xs text-muted-foreground">
            Análise gerada por IA em {format(new Date(report.generated_at), "dd/MM/yyyy HH:mm")} ·
            {report.evidence_used > 0
              ? ` ${report.evidence_used} evidências web consultadas como contexto.`
              : " sem evidências web recentes — interpretação baseada em conhecimento geral."}
          </p>
        </>
      )}
    </div>
  );
}

function SentimentBlock({ label, value, tone, icon }: { label: string; value: number; tone: "success" | "muted" | "destructive"; icon: React.ReactNode }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50">
      <div className={`flex items-center gap-2 text-xs uppercase tracking-wider ${cls} mb-2`}>
        {icon}{label}
      </div>
      <div className={`text-3xl font-bold tabular-nums ${cls}`}>{value}%</div>
    </div>
  );
}

function NarrativeColumn({ title, items, tone, icon }: { title: string; items: string[]; tone: "success" | "muted" | "destructive"; icon: React.ReactNode }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50 space-y-3">
      <div className={`flex items-center gap-2 text-sm font-semibold ${cls}`}>{icon}{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nada relevante detectado.</p>
      ) : (
        <ul className="space-y-2 text-sm leading-relaxed">
          {items.map((i, idx) => (
            <li key={idx} className="flex gap-2"><span className={cls}>•</span><span>{i}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TermGroup({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3">{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t, i) => (
            <Badge key={`${title}-${i}`} variant="outline" className="text-xs">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function RecommendationColumn({ title, items, tone, icon }: { title: string; items: string[]; tone: "success" | "destructive" | "primary"; icon: React.ReactNode }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50 space-y-3">
      <div className={`flex items-center gap-2 text-sm font-semibold ${cls}`}>{icon}{title}</div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Nenhuma recomendação no momento.</p>
      ) : (
        <ul className="space-y-2 text-sm leading-relaxed">
          {items.map((i, idx) => (
            <li key={idx} className="flex gap-2"><span className={cls}>›</span><span>{i}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-muted-foreground py-6 text-center">Nada detectado para este período.</div>;
}
