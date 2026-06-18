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
  RefreshCw, Flame, TrendingUp, TrendingDown, Radar as RadarIcon,
  Network, MessageSquare, Users, Zap, Languages,
} from "lucide-react";
import { format } from "date-fns";

// ------------------------------------------------------------
// Visão por Rede Social — Social Listening Qualitativo.
// Foco em percepção, polarização, gatilhos de engajamento e
// linguagem associada. Sem resumo executivo, narrativas ou
// recomendações (esses blocos vivem em outras abas).
// ------------------------------------------------------------

type Intensidade = "morna" | "quente" | "fervendo";
type Polarizacao = "BAIXA" | "MEDIA" | "ALTA";

interface ListeningReport {
  temperatura: {
    texto: string;
    intensidade: Intensidade;
    temas_dominantes: string[];
  };
  conversa_por_rede: Array<{ rede: string; papel: string }>;
  gatilhos: { aumenta: string[]; reduz: string[] };
  polarizacao: {
    nivel: Polarizacao;
    apoiadores: string;
    criticos: string;
    neutros: string;
  };
  linguagem: {
    palavras_recorrentes: string[];
    tom_dominante: string[];
    entidades: string[];
  };
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

const INTENSIDADE_META: Record<Intensidade, { label: string; cls: string; bar: string }> = {
  morna: { label: "Morna", cls: "text-muted-foreground border-muted-foreground/30 bg-muted/40", bar: "w-1/3" },
  quente: { label: "Quente", cls: "text-amber-500 border-amber-500/40 bg-amber-500/10", bar: "w-2/3" },
  fervendo: { label: "Fervendo", cls: "text-destructive border-destructive/40 bg-destructive/10", bar: "w-full" },
};

const POLARIZACAO_META: Record<Polarizacao, { label: string; cls: string }> = {
  BAIXA: { label: "BAIXA", cls: "bg-success/15 text-success border-success/30" },
  MEDIA: { label: "MÉDIA", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
  ALTA: { label: "ALTA", cls: "bg-destructive/15 text-destructive border-destructive/30" },
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
    queryKey: ["nv-listening", candidateId, network, range.start_date, range.end_date, nonce],
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
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Visão por Rede Social</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Social listening qualitativo — percepção, polarização, gatilhos e linguagem associada.
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
            Escolha um candidato para gerar a leitura de social listening.
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
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      )}

      {!needsCandidate && report && (
        <>
          {/* 1. TEMPERATURA DA REDE */}
          <TemperaturaCard temperatura={report.temperatura} />

          {/* 2. ONDE A CONVERSA ESTÁ MAIS ATIVA */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Onde a conversa está mais ativa</h2>
            </div>
            {report.conversa_por_rede.length === 0 ? (
              <Empty />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {report.conversa_por_rede.map((r, i) => (
                  <div key={i} className="rounded-lg border border-border p-4 bg-card/50">
                    <div className="flex items-center gap-2 mb-1.5">
                      <MessageSquare className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">{r.rede}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{r.papel}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* 3. GATILHOS DE ENGAJAMENTO */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Gatilhos de engajamento</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <GatilhoBlock
                title="O que aumenta comentários"
                items={report.gatilhos.aumenta}
                icon={<TrendingUp className="h-4 w-4" />}
                tone="success"
              />
              <GatilhoBlock
                title="O que reduz comentários"
                items={report.gatilhos.reduz}
                icon={<TrendingDown className="h-4 w-4" />}
                tone="muted"
              />
            </div>
          </Card>

          {/* 4. POLARIZAÇÃO */}
          <PolarizacaoCard polarizacao={report.polarizacao} />

          {/* 5. LINGUAGEM ASSOCIADA */}
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Languages className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Linguagem associada</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <LinguagemGroup title="Palavras recorrentes" items={report.linguagem.palavras_recorrentes} variant="secondary" />
              <LinguagemGroup title="Tom dominante" items={report.linguagem.tom_dominante} variant="outline" />
              <LinguagemGroup title="Entidades relacionadas" items={report.linguagem.entidades} variant="default" />
            </div>
          </Card>

          <p className="text-xs text-muted-foreground">
            Leitura gerada por IA em {format(new Date(report.generated_at), "dd/MM/yyyy HH:mm")} ·
            {report.evidence_used > 0
              ? ` ${report.evidence_used} evidências web consultadas como contexto.`
              : " sem evidências web recentes — interpretação baseada em conhecimento geral."}
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
        <Badge variant="outline" className={`text-xs uppercase tracking-wider px-3 py-1 ${meta.cls}`}>
          {meta.label}
        </Badge>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${meta.bar} transition-all`}
          style={{
            background: temperatura.intensidade === "fervendo"
              ? "linear-gradient(90deg, hsl(var(--success)), hsl(var(--warning, 38 92% 50%)), hsl(var(--destructive)))"
              : temperatura.intensidade === "quente"
              ? "linear-gradient(90deg, hsl(var(--success)), hsl(var(--warning, 38 92% 50%)))"
              : "hsl(var(--muted-foreground))",
          }}
        />
      </div>

      <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
        {temperatura.texto || "—"}
      </p>

      {temperatura.temas_dominantes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {temperatura.temas_dominantes.map((t, i) => (
            <Badge key={i} variant="secondary" className="text-xs">{t}</Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

function PolarizacaoCard({ polarizacao }: { polarizacao: ListeningReport["polarizacao"] }) {
  const meta = POLARIZACAO_META[polarizacao.nivel];
  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Polarização</h2>
        </div>
        <Badge className={`text-xs font-bold tracking-wider px-3 py-1 border ${meta.cls}`}>
          {meta.label}
        </Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <PolBlock label="Quem apoia" text={polarizacao.apoiadores} tone="success" />
        <PolBlock label="Quem critica" text={polarizacao.criticos} tone="destructive" />
        <PolBlock label="Quem observa" text={polarizacao.neutros} tone="muted" />
      </div>
    </Card>
  );
}

function PolBlock({ label, text, tone }: { label: string; text: string; tone: "success" | "destructive" | "muted" }) {
  const cls = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50 space-y-2">
      <div className={`text-xs uppercase tracking-wider font-semibold ${cls}`}>{label}</div>
      <p className="text-sm leading-relaxed">{text || "—"}</p>
    </div>
  );
}

function GatilhoBlock({ title, items, icon, tone }: { title: string; items: string[]; icon: React.ReactNode; tone: "success" | "muted" }) {
  const cls = tone === "success" ? "text-success" : "text-muted-foreground";
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

function LinguagemGroup({ title, items, variant }: { title: string; items: string[]; variant: "secondary" | "outline" | "default" }) {
  return (
    <div className="rounded-lg border border-border p-4 bg-card/50">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">{title}</div>
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

function Empty() {
  return <div className="text-sm text-muted-foreground py-6 text-center">Nada detectado para este período.</div>;
}
