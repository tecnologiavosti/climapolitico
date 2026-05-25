import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { isHiddenNetwork } from "@/lib/networkVisibility";
import { Heart, MessageCircle, Share2 } from "lucide-react";
import { subDays } from "date-fns";

interface Props {
  candidateId?: string;
  days?: number;
}

/**
 * Fase 6 — Reações por post.
 * Mostra % positivo/negativo/neutro agregado + tabela por post com barras empilhadas.
 * Substitui a visão de "curtidas totais" por algo mais qualitativo.
 */
export function ReactionsPerPost({ candidateId, days = 7 }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();

  const { data: interactions, isLoading } = useQuery({
    queryKey: ["reactions-per-post", user?.id, isAdmin, candidateId, days],
    queryFn: async () => {
      const since = subDays(new Date(), days).toISOString();
      let q = supabase
        .from("social_interactions")
        .select("id, social_network, comment_text, comment_author, likes_count, replies_count, shares_count, sentiment_label, collected_at, candidate_id")
        .gte("collected_at", since)
        .order("collected_at", { ascending: false })
        .limit(2000);
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      if (candidateId) q = q.eq("candidate_id", candidateId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []).filter((r) => !isHiddenNetwork(r.social_network));
    },
    enabled: !!user,
  });

  // Agregado geral
  const totals = useMemo(() => {
    const list = interactions || [];
    const pos = list.filter((r) => r.sentiment_label === "positive").length;
    const neg = list.filter((r) => r.sentiment_label === "negative").length;
    const neu = list.filter((r) => r.sentiment_label === "neutral").length;
    const labeled = pos + neg + neu;
    const totalInteractions = list.reduce(
      (s, r) => s + (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0),
      0,
    );
    return {
      pos, neg, neu, labeled, totalInteractions,
      posPct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
      negPct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
      neuPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
    };
  }, [interactions]);

  // Top posts (por engajamento) — para tabela + barras empilhadas
  const topPosts = useMemo(() => {
    return [...(interactions || [])]
      .map((r) => ({
        ...r,
        eng: (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0),
      }))
      .sort((a, b) => b.eng - a.eng)
      .slice(0, 10)
      .map((p, i) => ({
        ...p,
        label: `#${i + 1}`,
        positive: p.sentiment_label === "positive" ? p.eng : 0,
        negative: p.sentiment_label === "negative" ? p.eng : 0,
        neutral: p.sentiment_label === "neutral" ? p.eng : 0,
      }));
  }, [interactions]);

  return (
    <Card className="p-6 space-y-6">
      <HelpTooltip text="Em vez de só somar curtidas, mostramos a proporção de reações positivas, negativas e neutras dos posts. Mais útil pra entender o clima.">
        <div className="cursor-help">
          <h3 className="text-lg font-bold">Reações por post</h3>
          <p className="text-sm text-muted-foreground">Distribuição qualitativa nos últimos {days} dias</p>
        </div>
      </HelpTooltip>

      {/* Faixa percentual + total */}
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : totals.labeled === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Nenhuma reação analisada no período.
        </div>
      ) : (
        <>
          <div>
            <div className="flex h-8 w-full rounded-md overflow-hidden border border-border">
              <div
                className="bg-success flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${totals.posPct}%` }}
                title={`${totals.pos} positivas`}
              >
                {totals.posPct >= 8 && `${totals.posPct}%`}
              </div>
              <div
                className="bg-destructive flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${totals.negPct}%` }}
                title={`${totals.neg} negativas`}
              >
                {totals.negPct >= 8 && `${totals.negPct}%`}
              </div>
              <div
                className="bg-warning flex items-center justify-center text-white text-xs font-semibold"
                style={{ width: `${totals.neuPct}%` }}
                title={`${totals.neu} neutras`}
              >
                {totals.neuPct >= 8 && `${totals.neuPct}%`}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
              <div className="flex gap-4">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-success" /> Positivas: <strong>{totals.posPct}%</strong></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-destructive" /> Negativas: <strong>{totals.negPct}%</strong></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-warning" /> Neutras: <strong>{totals.neuPct}%</strong></span>
              </div>
              <div className="text-muted-foreground">
                Total: <strong className="text-foreground">{totals.totalInteractions.toLocaleString("pt-BR")}</strong> interações
              </div>
            </div>
          </div>

          {/* Barras empilhadas por post */}
          {topPosts.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Top 10 posts — engajamento por sentimento</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={topPosts}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-muted-foreground" />
                  <YAxis className="text-muted-foreground" />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                  <Bar dataKey="positive" stackId="a" fill="hsl(var(--success))" name="Positivo" />
                  <Bar dataKey="negative" stackId="a" fill="hsl(var(--destructive))" name="Negativo" />
                  <Bar dataKey="neutral" stackId="a" fill="hsl(var(--warning))" name="Neutro" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabela */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Post</TableHead>
                  <TableHead>Rede</TableHead>
                  <TableHead className="text-right"><Heart className="h-3.5 w-3.5 inline" /></TableHead>
                  <TableHead className="text-right"><MessageCircle className="h-3.5 w-3.5 inline" /></TableHead>
                  <TableHead className="text-right"><Share2 className="h-3.5 w-3.5 inline" /></TableHead>
                  <TableHead>Sentimento</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topPosts.map((p, i) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="text-xs line-clamp-2">{p.comment_text || "(sem texto)"}</p>
                      <span className="text-[10px] text-muted-foreground">{p.comment_author || "anônimo"}</span>
                    </TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{p.social_network}</Badge></TableCell>
                    <TableCell className="text-right text-xs">{(p.likes_count || 0).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right text-xs">{(p.replies_count || 0).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-right text-xs">{(p.shares_count || 0).toLocaleString("pt-BR")}</TableCell>
                    <TableCell>
                      {p.sentiment_label ? (
                        <Badge
                          variant={p.sentiment_label === "positive" ? "default" : p.sentiment_label === "negative" ? "destructive" : "secondary"}
                          className="text-[10px]"
                        >
                          {p.sentiment_label}
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{p.eng.toLocaleString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </Card>
  );
}
