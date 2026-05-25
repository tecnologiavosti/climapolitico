import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { isHiddenNetwork } from "@/lib/networkVisibility";
import { Heart, MessageCircle, Share2, ExternalLink, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { subDays } from "date-fns";
import { fetchAllPaginated } from "@/lib/supabasePagination";

interface Props {
  candidateId?: string;
  days?: number;
}

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

interface Group {
  key: string;
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

export function ReactionsPerPost({ candidateId, days = 7 }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [visibleCount, setVisibleCount] = useState(50);
  const [selected, setSelected] = useState<Group | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { data: interactions, isLoading } = useQuery({
    queryKey: ["reactions-per-post-full", user?.id, isAdmin, candidateId, days],
    queryFn: async () => {
      const since = subDays(new Date(), days).toISOString();
      const rows = await fetchAllPaginated<Row>((from, to) => {
        let q = supabase
          .from("social_interactions")
          .select("id, social_network, comment_text, comment_author, likes_count, replies_count, shares_count, sentiment_label, collected_at, candidate_id, post_id, parent_comment_id, root_comment_id")
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

  // Totais sobre TODA a base
  const totals = useMemo(() => {
    const list = interactions || [];
    const pos = list.filter((r) => r.sentiment_label === "positive").length;
    const neg = list.filter((r) => r.sentiment_label === "negative").length;
    const neu = list.filter((r) => r.sentiment_label === "neutral").length;
    const labeled = pos + neg + neu;
    const totalLikes = list.reduce((s, r) => s + (r.likes_count || 0), 0);
    const totalReplies = list.reduce((s, r) => s + (r.replies_count || 0), 0);
    const totalShares = list.reduce((s, r) => s + (r.shares_count || 0), 0);
    const rootSet = new Set<string>();
    list.forEach((r) => { if (!r.parent_comment_id && !r.root_comment_id) rootSet.add(r.post_id || r.id); else if (r.post_id) rootSet.add(r.post_id); });
    return {
      pos, neg, neu, labeled,
      totalRecords: list.length,
      rootPosts: rootSet.size,
      totalLikes, totalReplies, totalShares,
      totalInteractions: totalLikes + totalReplies + totalShares,
      posPct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
      negPct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
      neuPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
    };
  }, [interactions]);

  const groupedPosts = useMemo<Group[]>(() => {
    const list = interactions || [];
    const groups = new Map<string, Group>();
    for (const r of list) {
      const key = r.post_id || r.root_comment_id || r.id;
      let g = groups.get(key);
      if (!g) {
        g = { key, root: null, children: [], eng: 0, pos: 0, neg: 0, neu: 0, likes: 0, replies: 0, shares: 0 };
        groups.set(key, g);
      }
      const isRoot = !r.parent_comment_id && !r.root_comment_id;
      if (isRoot && !g.root) g.root = r; else g.children.push(r);
      g.likes += r.likes_count || 0;
      g.replies += r.replies_count || 0;
      g.shares += r.shares_count || 0;
      g.eng += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);
      if (r.sentiment_label === "positive") g.pos++;
      else if (r.sentiment_label === "negative") g.neg++;
      else if (r.sentiment_label === "neutral") g.neu++;
    }
    return Array.from(groups.values()).map((g) => ({ ...g, root: g.root || g.children[0] || null })).sort((a, b) => b.eng - a.eng);
  }, [interactions]);

  const visible = groupedPosts.slice(0, visibleCount);

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((n) => Math.min(n + 50, groupedPosts.length));
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [groupedPosts.length, visibleCount]);

  function dominantSentiment(g: Group): { label: string; color: string; Icon: any } {
    if (g.pos > g.neg && g.pos > g.neu) return { label: "Positivo", color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/10", Icon: ThumbsUp };
    if (g.neg > g.pos && g.neg > g.neu) return { label: "Negativo", color: "text-rose-600 border-rose-500/40 bg-rose-500/10", Icon: ThumbsDown };
    return { label: "Neutro", color: "text-muted-foreground border-border bg-muted", Icon: Minus };
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpTooltip text="Métricas calculadas sobre 100% dos comentários do período. Renderização paginada para suportar milhares de posts sem travar.">
          <div className="cursor-help">
            <h3 className="text-lg font-bold">Reações por post</h3>
            <p className="text-sm text-muted-foreground">Distribuição qualitativa nos últimos {days} dias</p>
          </div>
        </HelpTooltip>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : totals.totalRecords === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum comentário no período.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiBox label="Posts raiz" value={totals.rootPosts} />
            <KpiBox label="Comentários" value={totals.totalRecords - totals.rootPosts} />
            <KpiBox label="Curtidas" value={totals.totalLikes} />
            <KpiBox label="Compartilhamentos" value={totals.totalShares} />
            <KpiBox label="Interações totais" value={totals.totalInteractions} highlight />
          </div>

          <div>
            <div className="flex h-8 w-full rounded-md overflow-hidden border border-border">
              <div className="bg-success flex items-center justify-center text-white text-xs font-semibold" style={{ width: `${totals.posPct}%` }}>
                {totals.posPct >= 8 && `${totals.posPct}%`}
              </div>
              <div className="bg-destructive flex items-center justify-center text-white text-xs font-semibold" style={{ width: `${totals.negPct}%` }}>
                {totals.negPct >= 8 && `${totals.negPct}%`}
              </div>
              <div className="bg-warning flex items-center justify-center text-white text-xs font-semibold" style={{ width: `${totals.neuPct}%` }}>
                {totals.neuPct >= 8 && `${totals.neuPct}%`}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 mt-3 text-sm">
              <div className="flex gap-4 flex-wrap">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-success" /> Pos: <strong>{totals.pos.toLocaleString("pt-BR")}</strong></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-destructive" /> Neg: <strong>{totals.neg.toLocaleString("pt-BR")}</strong></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-warning" /> Neu: <strong>{totals.neu.toLocaleString("pt-BR")}</strong></span>
              </div>
              <div className="text-muted-foreground">
                {groupedPosts.length.toLocaleString("pt-BR")} posts • exibindo {Math.min(visibleCount, groupedPosts.length).toLocaleString("pt-BR")}
              </div>
            </div>
          </div>

          {/* Grid de cards responsivo */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {visible.map((g) => {
              const r = g.root!;
              const ds = dominantSentiment(g);
              return (
                <Card key={g.key} className="p-3 flex flex-col gap-2 hover:border-primary/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">{r?.social_network || "?"}</Badge>
                    <Badge className={`text-[10px] border ${ds.color}`}>
                      <ds.Icon className="h-3 w-3 mr-1" />{ds.label}
                    </Badge>
                  </div>
                  <p className="text-xs line-clamp-3 min-h-[3.6em]">{r?.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}</p>
                  <div className="text-[10px] text-muted-foreground truncate">{r?.comment_author || "anônimo"} • {g.children.length} respostas</div>
                  <div className="flex justify-between text-xs pt-2 border-t mt-auto">
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{g.likes.toLocaleString("pt-BR")}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{g.replies.toLocaleString("pt-BR")}</span>
                    <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{g.shares.toLocaleString("pt-BR")}</span>
                  </div>
                  <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => setSelected(g)}>
                    Ver detalhes <ExternalLink className="h-3 w-3 ml-1" />
                  </Button>
                </Card>
              );
            })}
          </div>

          {visibleCount < groupedPosts.length && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Button variant="outline" onClick={() => setVisibleCount((n) => Math.min(n + 50, groupedPosts.length))}>
                Carregar mais ({groupedPosts.length - visibleCount} restantes)
              </Button>
            </div>
          )}
        </>
      )}

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes do post</SheetTitle>
            <SheetDescription>{selected?.root?.social_network} • {selected?.root?.comment_author || "anônimo"}</SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 mt-4">
              <div className="p-3 bg-muted/40 rounded-md">
                <p className="text-sm whitespace-pre-wrap">{selected.root?.comment_text || "(sem texto)"}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <KpiBox label="Curtidas" value={selected.likes} />
                <KpiBox label="Respostas" value={selected.replies} />
                <KpiBox label="Shares" value={selected.shares} />
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">Distribuição de sentimento</h4>
                <div className="flex gap-3 text-sm">
                  <span className="text-emerald-600">{selected.pos} positivos</span>
                  <span className="text-rose-600">{selected.neg} negativos</span>
                  <span className="text-muted-foreground">{selected.neu} neutros</span>
                </div>
              </div>
              {selected.children.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">{selected.children.length} comentário(s)</h4>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {selected.children.slice(0, 50).map((c) => (
                      <div key={c.id} className="text-xs p-2 bg-muted/30 rounded">
                        <div className="flex justify-between mb-1">
                          <span className="font-medium">{c.comment_author || "anônimo"}</span>
                          <Badge variant="outline" className="text-[9px]">{c.sentiment_label || "—"}</Badge>
                        </div>
                        <p className="whitespace-pre-wrap">{c.comment_text || "(sem texto)"}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
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
