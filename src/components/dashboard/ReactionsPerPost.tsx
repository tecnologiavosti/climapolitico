import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { isHiddenNetwork } from "@/lib/networkVisibility";
import { Heart, MessageCircle, Share2 } from "lucide-react";
import { subDays } from "date-fns";
import { fetchAllPaginated } from "@/lib/supabasePagination";

interface Props {
  candidateId?: string;
  days?: number;
}

type PageSize = "50" | "100" | "500" | "1000" | "all";

interface Row {
  id: string;
  social_network: string;
  comment_text: string | null;
  comment_author: string | null;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  sentiment_label: string | null;
  collected_at: string | null;
  candidate_id: string | null;
  post_id: string | null;
  parent_comment_id: string | null;
  root_comment_id: string | null;
}

/**
 * Fase 6 — Reações por post.
 * Usa 100% dos comentários do período (paginação completa).
 * Métricas Pos/Neg/Neu calculadas sobre TODOS os registros.
 */
export function ReactionsPerPost({ candidateId, days = 7 }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [pageSize, setPageSize] = useState<PageSize>("100");

  const { data: interactions, isLoading } = useQuery({
    queryKey: ["reactions-per-post-full", user?.id, isAdmin, candidateId, days],
    queryFn: async () => {
      const since = subDays(new Date(), days).toISOString();
      const rows = await fetchAllPaginated<Row>((from, to) => {
        let q = supabase
          .from("social_interactions")
          .select(
            "id, social_network, comment_text, comment_author, likes_count, replies_count, shares_count, sentiment_label, collected_at, candidate_id, post_id, parent_comment_id, root_comment_id",
          )
          .gte("collected_at", since)
          .order("collected_at", { ascending: false })
          .range(from, to);
        if (!isAdmin && user) q = q.eq("user_id", user.id);
        if (candidateId) q = q.eq("candidate_id", candidateId);
        return q;
      });
      return rows.filter((r) => !isHiddenNetwork(r.social_network));
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // Totais agregados sobre TODA a base do período
  const totals = useMemo(() => {
    const list = interactions || [];
    const pos = list.filter((r) => r.sentiment_label === "positive").length;
    const neg = list.filter((r) => r.sentiment_label === "negative").length;
    const neu = list.filter((r) => r.sentiment_label === "neutral").length;
    const labeled = pos + neg + neu;
    const totalLikes = list.reduce((s, r) => s + (r.likes_count || 0), 0);
    const totalReplies = list.reduce((s, r) => s + (r.replies_count || 0), 0);
    const totalShares = list.reduce((s, r) => s + (r.shares_count || 0), 0);
    const totalInteractions = totalLikes + totalReplies + totalShares;

    // Posts raiz: sem parent_comment_id e sem root_comment_id
    const rootSet = new Set<string>();
    const commentsCount = list.filter((r) => r.parent_comment_id || r.root_comment_id).length;
    list.forEach((r) => {
      if (!r.parent_comment_id && !r.root_comment_id) {
        rootSet.add(r.post_id || r.id);
      } else if (r.post_id) {
        rootSet.add(r.post_id);
      }
    });

    return {
      pos,
      neg,
      neu,
      labeled,
      totalRecords: list.length,
      rootPosts: rootSet.size,
      commentsCount,
      totalLikes,
      totalReplies,
      totalShares,
      totalInteractions,
      posPct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
      negPct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
      neuPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
    };
  }, [interactions]);

  // Agrupa por post raiz; soma engajamento dos filhos
  const groupedPosts = useMemo(() => {
    const list = interactions || [];
    const groups = new Map<
      string,
      {
        root: Row | null;
        children: Row[];
        eng: number;
        pos: number;
        neg: number;
        neu: number;
        likes: number;
        replies: number;
        shares: number;
      }
    >();
    for (const r of list) {
      const key = r.post_id || r.root_comment_id || r.id;
      let g = groups.get(key);
      if (!g) {
        g = { root: null, children: [], eng: 0, pos: 0, neg: 0, neu: 0, likes: 0, replies: 0, shares: 0 };
        groups.set(key, g);
      }
      const isRoot = !r.parent_comment_id && !r.root_comment_id;
      if (isRoot && !g.root) g.root = r;
      else g.children.push(r);
      g.likes += r.likes_count || 0;
      g.replies += r.replies_count || 0;
      g.shares += r.shares_count || 0;
      g.eng += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);
      if (r.sentiment_label === "positive") g.pos++;
      else if (r.sentiment_label === "negative") g.neg++;
      else if (r.sentiment_label === "neutral") g.neu++;
    }
    // Garante "root" mesmo quando não veio explícito
    const arr = Array.from(groups.values()).map((g) => ({
      ...g,
      root: g.root || g.children[0] || null,
    }));
    return arr.sort((a, b) => b.eng - a.eng);
  }, [interactions]);

  const visiblePosts = useMemo(() => {
    if (pageSize === "all") return groupedPosts;
    const n = Number(pageSize);
    return groupedPosts.slice(0, n);
  }, [groupedPosts, pageSize]);

  const chartData = useMemo(
    () =>
      visiblePosts.slice(0, 20).map((g, i) => ({
        label: `#${i + 1}`,
        positive: g.pos > 0 ? g.eng : 0,
        negative: g.neg > 0 ? g.eng : 0,
        neutral: g.neu > 0 ? g.eng : 0,
        eng: g.eng,
      })),
    [visiblePosts],
  );

  return (
    <Card className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpTooltip text="Métricas calculadas sobre 100% dos comentários do período — posts raiz, respostas, sub-comentários, likes e compartilhamentos.">
          <div className="cursor-help">
            <h3 className="text-lg font-bold">Reações por post</h3>
            <p className="text-sm text-muted-foreground">
              Distribuição qualitativa nos últimos {days} dias
            </p>
          </div>
        </HelpTooltip>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Mostrar</span>
          <Select value={pageSize} onValueChange={(v) => setPageSize(v as PageSize)}>
            <SelectTrigger className="w-[110px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 posts</SelectItem>
              <SelectItem value="100">100 posts</SelectItem>
              <SelectItem value="500">500 posts</SelectItem>
              <SelectItem value="1000">1000 posts</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs */}
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : totals.totalRecords === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Nenhum comentário no período.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiBox label="Posts raiz" value={totals.rootPosts} />
            <KpiBox label="Comentários/respostas" value={totals.commentsCount} />
            <KpiBox label="Curtidas" value={totals.totalLikes} />
            <KpiBox label="Compartilhamentos" value={totals.totalShares} />
            <KpiBox label="Interações totais" value={totals.totalInteractions} highlight />
          </div>

          {/* Faixa percentual sobre TODOS os registros classificados */}
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
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-success" /> Positivas:{" "}
                  <strong>{totals.pos.toLocaleString("pt-BR")}</strong> ({totals.posPct}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-destructive" /> Negativas:{" "}
                  <strong>{totals.neg.toLocaleString("pt-BR")}</strong> ({totals.negPct}%)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-warning" /> Neutras:{" "}
                  <strong>{totals.neu.toLocaleString("pt-BR")}</strong> ({totals.neuPct}%)
                </span>
              </div>
              <div className="text-muted-foreground">
                Base: <strong className="text-foreground">{totals.labeled.toLocaleString("pt-BR")}</strong>{" "}
                classificados de <strong className="text-foreground">{totals.totalRecords.toLocaleString("pt-BR")}</strong> registros
              </div>
            </div>
          </div>

          {/* Barras empilhadas */}
          {chartData.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">
                Top {Math.min(20, visiblePosts.length)} posts — engajamento por sentimento dominante
              </p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" className="text-muted-foreground" />
                  <YAxis className="text-muted-foreground" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
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
                  <TableHead className="text-right">
                    <Heart className="h-3.5 w-3.5 inline" />
                  </TableHead>
                  <TableHead className="text-right">
                    <MessageCircle className="h-3.5 w-3.5 inline" />
                  </TableHead>
                  <TableHead className="text-right">
                    <Share2 className="h-3.5 w-3.5 inline" />
                  </TableHead>
                  <TableHead>Pos / Neg / Neu</TableHead>
                  <TableHead className="text-right">Engajamento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visiblePosts.map((g, i) => {
                  const r = g.root;
                  return (
                    <TableRow key={(r?.id || i) + "_" + i}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="max-w-[260px]">
                        <p className="text-xs line-clamp-2">{r?.comment_text || "(sem texto)"}</p>
                        <span className="text-[10px] text-muted-foreground">
                          {r?.comment_author || "anônimo"} • {g.children.length} respostas
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {r?.social_network}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs">{g.likes.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right text-xs">{g.replies.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right text-xs">{g.shares.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-xs">
                        <span className="text-success">{g.pos}</span> /{" "}
                        <span className="text-destructive">{g.neg}</span> /{" "}
                        <span className="text-warning">{g.neu}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">{g.eng.toLocaleString("pt-BR")}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-2">
              Exibindo {visiblePosts.length.toLocaleString("pt-BR")} de{" "}
              {groupedPosts.length.toLocaleString("pt-BR")} posts agrupados
            </p>
          </div>
        </>
      )}
    </Card>
  );
}

function KpiBox({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${highlight ? "bg-primary/10 border border-primary/30" : "bg-muted/40"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}
