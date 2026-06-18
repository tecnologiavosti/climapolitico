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
  RefreshCw, Flame, ThumbsUp, ThumbsDown, Radar as RadarIcon,
  Gauge, Layers, BookText, Siren, Sparkles, AlertOctagon, CheckCircle2,
} from "lucide-react";
import { format } from "date-fns";

// ------------------------------------------------------------
// Visão por Rede Social — Social Listening enterprise.
// Blocos: Temperatura · Termômetro de Reputação · Vetores de
// Polarização · Gatilhos Emocionais · Vocabulário da Rede ·
// Risco de Viralização.
// ------------------------------------------------------------

type Intensidade = "morna" | "quente" | "fervendo";
type Reputacao = "favoravel" | "neutro" | "desgastado" | "polarizado" | "em_ascensao" | "em_queda";
type Viralizacao = "alta" | "media" | "baixa";

interface ListeningReport {
  temperatura: { texto: string; intensidade: Intensidade; temas_dominantes: string[] };
  reputacao: { status: Reputacao; texto: string };
  vetores_polarizacao: {
    ideologica: number; regional: number; geracional: number; tematica: number; nota: string;
  };
  gatilhos_emocionais: { apoio: string[]; rejeicao: string[] };
  vocabulario: {
    palavras_nucleares: string[]; adjetivos_associados: string[]; frases_recorrentes: string[];
  };
  risco_viralizacao: Array<{ tema: string; nivel: Viralizacao; motivo: string }>;
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

const INTENSIDADE_META: Record<Intensidade, { label: string; cls: string }> = {
  morna: { label: "Morna", cls: "text-muted-foreground border-muted-foreground/30 bg-muted/40" },
  quente: { label: "Quente", cls: "text-amber-500 border-amber-500/40 bg-amber-500/10" },
  fervendo: { label: "Fervendo", cls: "text-destructive border-destructive/40 bg-destructive/10" },
};

const REPUTACAO_META: Record<Reputacao, { label: string; cls: string }> = {
  favoravel: { label: "Favorável", cls: "bg-success/15 text-success border-success/40" },
  neutro: { label: "Neutro", cls: "bg-muted text-muted-foreground border-border" },
  desgastado: { label: "Desgastado", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  polarizado: { label: "Polarizado", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  em_ascensao: { label: "Em ascensão", cls: "bg-primary/15 text-primary border-primary/40" },
  em_queda: { label: "Em queda", cls: "bg-destructive/15 text-destructive border-destructive/40" },
};

const VIRAL_META: Record<Viralizacao, { label: string; emoji: string; cls: string }> = {
  alta: { label: "Alta chance", emoji: "🔥", cls: "bg-destructive/15 text-destructive border-destructive/40" },
  media: { label: "Média chance", emoji: "⚠️", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  baixa: { label: "Baixa chance", emoji: "✓", cls: "bg-success/15 text-success border-success/40" },
};

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
    queryKey: ["nv-listening-v3", candidateId, network, range.start_date, range.end_date, nonce],
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
      return (data as any).report as ListeningReport;
    },
  });

  const report = analysis.data;
  const loading = analysis.isFetching;
  const needsCandidate = candidateId === "all";

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Social listening político — reputação, polarização e gatilhos emocionais por candidato.
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
              <Button key={p.value} type="button" variant={days === p.value ? "default" : "outline"} size="sm" onClick={() => setDays(p.value)}>
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
          <p className="text-sm text-muted-foreground">Escolha um candidato para gerar a leitura de social listening.</p>
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
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!needsCandidate && report && (
        <>
          <TemperaturaCard temperatura={report.temperatura} />
          <ReputacaoCard reputacao={report.reputacao} />
          <VetoresCard vetores={report.vetores_polarizacao} />
          <GatilhosCard gatilhos={report.gatilhos_emocionais} />
          <VocabularioCard vocabulario={report.vocabulario} />
          <ViralizacaoCard temas={report.risco_viralizacao} />

          <p className="text-xs text-muted-foreground">
            Leitura gerada por IA em {format(new Date(report.generated_at), "dd/MM/yyyy HH:mm")} ·
            {report.evidence_used > 0
              ? ` ${report.evidence_used} evidências web consultadas como contexto.`
              : " interpretação baseada em conhecimento político geral."}
          </p>
        </>
      )}
    </div>
  );
}

function TemperaturaCard({ temperatura }: { temperatura: ListeningReport["temperatura"] }) {
  const meta = INTENSIDADE_META[temperatura.intensidade];
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Temperatura da rede</h2>
        </div>
        <Badge variant="outline" className={`text-xs uppercase tracking-wider px-3 py-1 ${meta.cls}`}>{meta.label}</Badge>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{temperatura.texto || "—"}</p>
      {temperatura.temas_dominantes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {temperatura.temas_dominantes.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function ReputacaoCard({ reputacao }: { reputacao: ListeningReport["reputacao"] }) {
  const meta = REPUTACAO_META[reputacao.status];
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Termômetro de reputação</h2>
        </div>
        <Badge className={`text-xs font-bold tracking-wider px-3 py-1 border ${meta.cls}`}>{meta.label.toUpperCase()}</Badge>
      </div>
      <p className="text-sm leading-relaxed">{reputacao.texto || "—"}</p>
    </Card>
  );
}

function VetoresCard({ vetores }: { vetores: ListeningReport["vetores_polarizacao"] }) {
  const items: Array<{ label: string; value: number }> = [
    { label: "Polarização ideológica", value: vetores.ideologica },
    { label: "Polarização regional", value: vetores.regional },
    { label: "Polarização geracional", value: vetores.geracional },
    { label: "Polarização temática", value: vetores.tematica },
  ];
  return (
    <Card className="p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Layers className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Vetores de polarização</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {items.map((it) => (
          <div key={it.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{it.label}</span>
              <span className="font-semibold tabular-nums">{it.value}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${it.value}%`,
                  background: it.value >= 75
                    ? "hsl(var(--destructive))"
                    : it.value >= 50
                    ? "hsl(38 92% 50%)"
                    : "hsl(var(--primary))",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      {vetores.nota && (
        <p className="text-xs text-muted-foreground italic border-l-2 border-primary/40 pl-3">{vetores.nota}</p>
      )}
    </Card>
  );
}

function GatilhosCard({ gatilhos }: { gatilhos: ListeningReport["gatilhos_emocionais"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Gatilhos emocionais</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GatilhoBlock title="O que gera APOIO" items={gatilhos.apoio} tone="success" icon={<ThumbsUp className="h-4 w-4" />} />
        <GatilhoBlock title="O que gera REJEIÇÃO" items={gatilhos.rejeicao} tone="destructive" icon={<ThumbsDown className="h-4 w-4" />} />
      </div>
    </Card>
  );
}

function GatilhoBlock({ title, items, tone, icon }: { title: string; items: string[]; tone: "success" | "destructive"; icon: React.ReactNode }) {
  const cls = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className={`rounded-lg border p-4 bg-card/50 space-y-3 ${tone === "success" ? "border-success/30" : "border-destructive/30"}`}>
      <div className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${cls}`}>{icon}{title}</div>
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

function VocabularioCard({ vocabulario }: { vocabulario: ListeningReport["vocabulario"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <BookText className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Vocabulário da rede</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <VocabGroup title="Palavras nucleares" subtitle="Termos diretamente ligados ao candidato" items={vocabulario.palavras_nucleares} variant="default" />
        <VocabGroup title="Adjetivos associados" subtitle="Como a rede descreve o candidato" items={vocabulario.adjetivos_associados} variant="secondary" />
        <VocabGroup title="Frases recorrentes" subtitle="Expressões que aparecem com frequência" items={vocabulario.frases_recorrentes} variant="outline" />
      </div>
    </Card>
  );
}

function VocabGroup({ title, subtitle, items, variant }: { title: string; subtitle: string; items: string[]; variant: "default" | "secondary" | "outline" }) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50 space-y-3">
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">—</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((t, i) => (
            <Badge key={`${title}-${i}`} variant={variant} className="text-xs">{t}</Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function ViralizacaoCard({ temas }: { temas: ListeningReport["risco_viralizacao"] }) {
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Siren className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Risco de viralização</h2>
      </div>
      {temas.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">Nenhum tema com risco identificado.</p>
      ) : (
        <ul className="space-y-2">
          {temas.map((t, i) => {
            const meta = VIRAL_META[t.nivel];
            const Icon = t.nivel === "alta" ? AlertOctagon : t.nivel === "media" ? Siren : CheckCircle2;
            return (
              <li key={i} className={`rounded-lg border p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${meta.cls}`}>
                <div className="flex items-center gap-2 sm:min-w-[180px]">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase tracking-wider">{meta.emoji} {meta.label}</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-foreground">{t.tema}</div>
                  {t.motivo && <div className="text-xs text-muted-foreground mt-0.5">{t.motivo}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
