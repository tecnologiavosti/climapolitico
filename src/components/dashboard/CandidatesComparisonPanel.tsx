import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
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
 * Comparativo consolidado — TODOS os candidatos.
 * Barra horizontal empilhada Pos/Neg normalizada (Pos + Neg = 100%, neutros ignorados).
 * Ordenado por volume total de menções.
 */
export function CandidatesComparisonPanel({ candidates }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const { data: allMetrics, isLoading } = useAllCandidateMetrics();

  const metricsMap = useMemo(() => {
    const map: Record<string, CandidateMetrics> = {};
    for (const m of allMetrics || []) map[m.candidateId] = m;
    return map;
  }, [allMetrics]);

  const rows = useMemo(() => {
    return candidates.map((c) => {
      const m = metricsMap[c.id];
      return {
        candidate: c,
        mentions: m?.totalMentions ?? 0,
        positive: m?.positiveCount ?? 0,
        negative: m?.negativeCount ?? 0,
      };
    }).sort((a, b) => b.mentions - a.mentions);
  }, [candidates, metricsMap]);

  const chartData = useMemo(
    () => rows.map((r) => {
      const t = r.positive + r.negative;
      return {
        name: r.candidate.full_name,
        Positivo: t > 0 ? Math.round((r.positive / t) * 100) : 0,
        Negativo: t > 0 ? Math.round((r.negative / t) * 100) : 0,
        mentions: r.mentions,
        opinionated: t,
      };
    }).filter((d) => d.opinionated > 0),
    [rows],
  );

  const top5Ids = rows.slice(0, 5).map((r) => r.candidate.id);
  const { data: timeline } = useQuery({
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

  const colors = ["hsl(var(--primary))", "hsl(var(--success))", "hsl(var(--warning))", "hsl(var(--destructive))", "hsl(var(--accent))"];
  const chartHeight = Math.max(280, chartData.length * 36);

  return (
    <Card className="p-6 space-y-6">
      <HelpTooltip text="Compara TODOS os candidatos por aceitação (Positivo) e rejeição (Negativo) normalizados — neutros excluídos. Ordenado pelo volume total de menções.">
        <div className="cursor-help">
          <h3 className="text-lg font-bold">Comparativo consolidado — Aceitação vs Rejeição</h3>
          <p className="text-sm text-muted-foreground">{rows.length} candidato(s) • Pos + Neg = 100% (neutros excluídos)</p>
        </div>
      </HelpTooltip>

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Sem menções classificadas com Positivo/Negativo.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={chartHeight}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} className="text-muted-foreground" />
              <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} className="text-muted-foreground" />
              <Tooltip
                formatter={(v: any, n: any) => [`${v}%`, n]}
                labelFormatter={(label, items) => {
                  const it: any = items?.[0]?.payload;
                  return `${label}${it ? ` • ${Number(it.mentions ?? 0).toLocaleString("pt-BR")} menções` : ""}`;
                }}
                contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
              />
              <Legend />
              <Bar dataKey="Positivo" stackId="s" fill="hsl(var(--success))" />
              <Bar dataKey="Negativo" stackId="s" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>

          {top5Ids.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Evolução temporal — top 5 (últimos 14 dias)</p>
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
            </div>
          )}
        </>
      )}

      <div className="text-xs text-muted-foreground flex flex-wrap gap-2 pt-3 border-t">
        {rows.slice(0, 12).map((r) => (
          <Badge key={r.candidate.id} variant="outline" className="text-[10px]">
            {r.candidate.full_name}: {Number(r.mentions ?? 0).toLocaleString("pt-BR")}
          </Badge>
        ))}
      </div>
    </Card>
  );
}
