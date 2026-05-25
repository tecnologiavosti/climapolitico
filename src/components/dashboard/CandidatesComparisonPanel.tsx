import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useAllCandidateMetrics, CandidateMetrics } from "@/hooks/useCandidateMetrics";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { format, subDays } from "date-fns";

interface Candidate {
  id: string;
  full_name: string;
  party?: string | null;
  region?: string | null;
}

interface Props {
  candidates: Candidate[];
}

/**
 * Fase 8 — Comparativo consolidado.
 * Tabela multi-candidato + barras comparativas + pizza de participação + linha temporal.
 */
export function CandidatesComparisonPanel({ candidates }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const candidateIds = candidates.map((c) => c.id);
  const { metricsMap, isLoading } = useAllCandidateMetrics(candidateIds);

  // Linhas: candidato + métricas agregadas
  const rows = useMemo(() => {
    return candidates.map((c) => {
      const m: CandidateMetrics | undefined = metricsMap[c.id];
      return {
        candidate: c,
        mentions: m?.totalMentions ?? 0,
        engagement: m?.totalEngagement ?? 0,
        sentiment: Math.round(m?.averageSentiment ?? 50),
        positive: m?.positiveCount ?? 0,
        negative: m?.negativeCount ?? 0,
        neutral: m?.neutralCount ?? 0,
      };
    }).sort((a, b) => b.mentions - a.mentions);
  }, [candidates, metricsMap]);

  // Evolução temporal — últimos 14 dias por candidato (top 5)
  const top5Ids = rows.slice(0, 5).map((r) => r.candidate.id);
  const { data: timeline, isLoading: loadingTimeline } = useQuery({
    queryKey: ["comparison-timeline", user?.id, isAdmin, top5Ids.join(",")],
    queryFn: async () => {
      if (top5Ids.length === 0) return [];
      const since = subDays(new Date(), 14).toISOString();
      let q = supabase
        .from("social_interactions")
        .select("candidate_id, collected_at")
        .in("candidate_id", top5Ids)
        .gte("collected_at", since)
        .order("collected_at", { ascending: true })
        .limit(10000);
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && top5Ids.length > 0,
  });

  const timelineData = useMemo(() => {
    const days = 14;
    const buckets: Record<string, any> = {};
    for (let i = days - 1; i >= 0; i--) {
      const k = format(subDays(new Date(), i), "dd/MM");
      buckets[k] = { date: k };
      for (const id of top5Ids) buckets[k][id] = 0;
    }
    for (const r of timeline || []) {
      if (!r.collected_at) continue;
      const k = format(new Date(r.collected_at), "dd/MM");
      if (buckets[k]) buckets[k][r.candidate_id] = (buckets[k][r.candidate_id] || 0) + 1;
    }
    return Object.values(buckets);
  }, [timeline, top5Ids]);

  // Crescimento: comparar primeira semana vs segunda semana
  const growthMap = useMemo(() => {
    const map: Record<string, number> = {};
    const cutoff = subDays(new Date(), 7).getTime();
    for (const id of candidateIds) {
      const all = (timeline || []).filter((r) => r.candidate_id === id);
      const recent = all.filter((r) => new Date(r.collected_at || 0).getTime() >= cutoff).length;
      const previous = all.length - recent;
      map[id] = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : recent > 0 ? 100 : 0;
    }
    return map;
  }, [timeline, candidateIds]);

  // Cores estáveis para linhas
  const colors = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))"];

  // Participação de sentimento (positivo) entre top 5
  const sentimentShare = useMemo(() =>
    rows.slice(0, 5)
      .filter((r) => r.positive > 0)
      .map((r, i) => ({
        name: r.candidate.full_name,
        value: r.positive,
        color: colors[i % colors.length],
      })),
  [rows]);

  return (
    <Card className="p-6 space-y-6">
      <HelpTooltip text="Compara todos os seus candidatos lado a lado: menções, sentimento, engajamento e crescimento na mesma tabela.">
        <div className="cursor-help">
          <h3 className="text-lg font-bold">Comparativo consolidado</h3>
          <p className="text-sm text-muted-foreground">Todos os candidatos lado a lado</p>
        </div>
      </HelpTooltip>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum candidato cadastrado.</div>
      ) : (
        <>
          {/* Tabela */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidato</TableHead>
                  <TableHead className="text-right">Menções</TableHead>
                  <TableHead className="text-right">Sentimento</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                  <TableHead className="text-right">Crescimento 7d</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const growth = growthMap[r.candidate.id] ?? 0;
                  return (
                    <TableRow key={r.candidate.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{r.candidate.full_name}</p>
                          <div className="flex gap-1 mt-0.5">
                            {r.candidate.party && <Badge variant="outline" className="text-[10px]">{r.candidate.party}</Badge>}
                            {r.candidate.region && <Badge variant="secondary" className="text-[10px]">{r.candidate.region}</Badge>}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{r.mentions.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">
                        <span className={r.sentiment >= 60 ? "text-success font-semibold" : r.sentiment <= 40 ? "text-destructive font-semibold" : "text-warning"}>
                          {r.sentiment}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{r.engagement.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">
                        <span className={`inline-flex items-center gap-1 font-medium ${growth > 0 ? "text-success" : growth < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                          {growth > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : growth < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                          {growth > 0 ? "+" : ""}{growth}%
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Gráficos */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Barras: menções por candidato */}
            <div>
              <p className="text-sm font-medium mb-2">Menções por candidato</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rows.slice(0, 10).map((r) => ({ name: r.candidate.full_name, mentions: r.mentions, sentiment: r.sentiment }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" className="text-muted-foreground" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={70} />
                  <YAxis className="text-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="mentions" fill="hsl(var(--primary))" name="Menções" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Pizza: participação de positivas */}
            <div>
              <p className="text-sm font-medium mb-2">Participação de reações positivas (top 5)</p>
              {sentimentShare.length === 0 ? (
                <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">Sem reações positivas analisadas.</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={sentimentShare} cx="50%" cy="50%" outerRadius={85} dataKey="value" label={(e: any) => `${e.name}`}>
                      {sentimentShare.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Linhas: evolução 14 dias */}
          <div>
            <p className="text-sm font-medium mb-2">Evolução temporal — top 5 (últimos 14 dias)</p>
            {loadingTimeline ? <Skeleton className="h-[240px] w-full" /> : top5Ids.length === 0 ? (
              <div className="h-[240px] flex items-center justify-center text-muted-foreground text-sm">Sem dados temporais.</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={timelineData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" className="text-muted-foreground" />
                  <YAxis className="text-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  {top5Ids.map((id, i) => {
                    const name = candidates.find((c) => c.id === id)?.full_name ?? id;
                    return <Line key={id} type="monotone" dataKey={id} stroke={colors[i % colors.length]} strokeWidth={2} name={name} dot={false} />;
                  })}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
