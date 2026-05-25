import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { isHiddenNetwork } from "@/lib/networkVisibility";
import { Heart, MessageCircle, Share2, ExternalLink, ThumbsUp, ThumbsDown, Minus, ArrowRight } from "lucide-react";
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
  score: number;
}

const STOPWORDS = new Set([
  "para","como","mais","muito","pela","pelo","isso","essa","esse","esta","este","entre","sobre","quando","onde","tambem","também","presidente","candidato","brasil","politica","política","governo","partido","povo","gente","tudo","todos","todas","agora","hoje","ontem","sempre","nunca","assim","porque","mesmo","quem","tem","tinha","foi","sao","são","dos","das","com","sem","por","seu","sua","meu","minha","nos","nas","que","dele","dela","aqui","ali","ainda","depois","antes","pouco","você","voce","eles","elas","ser","ter","vai","vou","era","pra","pro","não","nao","sim","cada","anos","contra","favor","https","http","aaaa","aaaaa"
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z]{5,}/g) || [];
}

export function ReactionsPerPost({ candidateId, days = 7 }: Props) {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selected, setSelected] = useState<Group | null>(null);
  const [open, setOpen] = useState(false);
  const [filterSentiment, setFilterSentiment] = useState<string>("all");
  const [filterNetwork, setFilterNetwork] = useState<string>("all");
  const [filterDate, setFilterDate] = useState<string>("");
  const [visibleCount, setVisibleCount] = useState(50);
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

  // Totais — sentimento agregado sobre TUDO (raiz + comentários + respostas + subcomentários)
  const totals = useMemo(() => {
    const list = interactions || [];
    const pos = list.filter((r) => r.sentiment_label === "positive").length;
    const neg = list.filter((r) => r.sentiment_label === "negative").length;
    const neu = list.filter((r) => r.sentiment_label === "neutral").length;
    const labeled = pos + neg + neu;
    const unanalyzed = list.length - labeled;
    const totalLikes = list.reduce((s, r) => s + (r.likes_count || 0), 0);
    const totalReplies = list.reduce((s, r) => s + (r.replies_count || 0), 0);
    const totalShares = list.reduce((s, r) => s + (r.shares_count || 0), 0);
    // Posts = registros distintos de post_id (cada post_id = 1 post)
    const postSet = new Set<string>();
    list.forEach((r) => { if (r.post_id) postSet.add(r.post_id); });
    const postsCount = postSet.size;
    // Comentários = qualquer registro que NÃO é o post raiz (tem parent ou root_comment_id)
    const commentsCount = list.filter((r) => r.parent_comment_id || r.root_comment_id).length;
    return {
      pos, neg, neu, labeled, unanalyzed,
      totalRecords: list.length,
      postsCount,
      commentsCount,
      totalLikes, totalReplies, totalShares,
      totalInteractions: totalLikes + totalReplies + totalShares,
      posPct: labeled > 0 ? Math.round((pos / labeled) * 100) : 0,
      negPct: labeled > 0 ? Math.round((neg / labeled) * 100) : 0,
      neuPct: labeled > 0 ? Math.round((neu / labeled) * 100) : 0,
    };
  }, [interactions]);


  // Top assuntos (tokens dominantes em posts raiz)
  const topTopics = useMemo(() => {
    const list = interactions || [];
    const counts = new Map<string, number>();
    list.forEach((r) => {
      if (!r.comment_text) return;
      tokenize(r.comment_text).forEach((tok) => {
        if (STOPWORDS.has(tok)) return;
        counts.set(tok, (counts.get(tok) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
  }, [interactions]);

  // Agrupar por post
  const groupedPosts = useMemo<Group[]>(() => {
    const list = interactions || [];
    const groups = new Map<string, Group>();
    for (const r of list) {
      const key = r.post_id || r.root_comment_id || r.id;
      let g = groups.get(key);
      if (!g) {
        g = { key, root: null, children: [], eng: 0, pos: 0, neg: 0, neu: 0, likes: 0, replies: 0, shares: 0, score: 0 };
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
    // score = engajamento × (1 + relevância via respostas) × |sentimento|
    return Array.from(groups.values())
      .map((g) => {
        const totalSent = g.pos + g.neg + g.neu;
        const sentBias = totalSent > 0 ? Math.abs(g.pos - g.neg) / totalSent : 0;
        const relevance = 1 + Math.log10(1 + g.children.length);
        const score = g.eng * relevance * (0.5 + sentBias);
        return { ...g, root: g.root || g.children[0] || null, score };
      })
      .sort((a, b) => b.score - a.score);
  }, [interactions]);

  const top5 = groupedPosts.slice(0, 5);

  // Filtros do drawer
  const networks = useMemo(() => {
    const s = new Set<string>();
    groupedPosts.forEach((g) => g.root?.social_network && s.add(g.root.social_network));
    return [...s];
  }, [groupedPosts]);

  const filtered = useMemo(() => {
    return groupedPosts.filter((g) => {
      if (filterNetwork !== "all" && g.root?.social_network !== filterNetwork) return false;
      if (filterSentiment !== "all") {
        const ds = g.pos > g.neg && g.pos > g.neu ? "positive" : g.neg > g.pos && g.neg > g.neu ? "negative" : "neutral";
        if (ds !== filterSentiment) return false;
      }
      if (filterDate && g.root?.collected_at && !g.root.collected_at.startsWith(filterDate)) return false;
      return true;
    });
  }, [groupedPosts, filterNetwork, filterSentiment, filterDate]);

  const visible = filtered.slice(0, visibleCount);

  // Infinite scroll dentro do drawer
  useEffect(() => {
    if (!open) return;
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((n) => Math.min(n + 50, filtered.length));
      }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [open, filtered.length]);

  useEffect(() => { setVisibleCount(50); }, [filterNetwork, filterSentiment, filterDate, open]);

  function dominantSentiment(g: Group): { label: string; color: string; Icon: any } {
    if (g.pos > g.neg && g.pos > g.neu) return { label: "Positivo", color: "text-emerald-600 border-emerald-500/40 bg-emerald-500/10", Icon: ThumbsUp };
    if (g.neg > g.pos && g.neg > g.neu) return { label: "Negativo", color: "text-rose-600 border-rose-500/40 bg-rose-500/10", Icon: ThumbsDown };
    return { label: "Neutro", color: "text-muted-foreground border-border bg-muted", Icon: Minus };
  }

  return (
    <Card className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <HelpTooltip text="Resumo de 100% dos posts do período. Os detalhes ficam no drawer lateral para não poluir a visão geral.">
          <div className="cursor-help">
            <h3 className="text-lg font-bold">Reações por posts</h3>
            <p className="text-sm text-muted-foreground">Resumo estratégico dos últimos {days} dias</p>
          </div>
        </HelpTooltip>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : totals.totalRecords === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Nenhum comentário no período.</div>
      ) : (
        <>
          {/* Resumo */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiBox label="Total de posts" value={groupedPosts.length} />
            <KpiBox label={`Positivas (${totals.posPct}%)`} value={totals.pos} tone="pos" />
            <KpiBox label={`Negativas (${totals.negPct}%)`} value={totals.neg} tone="neg" />
            <KpiBox label={`Neutras (${totals.neuPct}%)`} value={totals.neu} tone="neu" />
          </div>

          <div className="flex h-3 w-full rounded overflow-hidden border border-border">
            <div className="bg-success" style={{ width: `${totals.posPct}%` }} />
            <div className="bg-warning" style={{ width: `${totals.neuPct}%` }} />
            <div className="bg-destructive" style={{ width: `${totals.negPct}%` }} />
          </div>

          {topTopics.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Top assuntos:</span>
              {topTopics.map((t) => (
                <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
              ))}
            </div>
          )}

          {/* Top 5 */}
          <div>
            <h4 className="text-sm font-semibold mb-2">Top 5 posts relevantes</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              {top5.map((g) => {
                const r = g.root!;
                const ds = dominantSentiment(g);
                return (
                  <Card key={g.key} className="p-3 flex flex-col gap-2 hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setSelected(g)}>
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className="text-[10px]">{r?.social_network || "?"}</Badge>
                      <Badge className={`text-[10px] border ${ds.color}`}><ds.Icon className="h-3 w-3 mr-1" />{ds.label}</Badge>
                    </div>
                    <p className="text-xs line-clamp-3 min-h-[3.6em]">{r?.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}</p>
                    <div className="text-[10px] text-muted-foreground truncate">{r?.comment_author || "anônimo"}</div>
                    <div className="flex justify-between text-xs pt-2 border-t mt-auto">
                      <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{g.likes.toLocaleString("pt-BR")}</span>
                      <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{g.replies.toLocaleString("pt-BR")}</span>
                      <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{g.shares.toLocaleString("pt-BR")}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center">
            <Button onClick={() => setOpen(true)} variant="default">
              Ver mais posts ({groupedPosts.length.toLocaleString("pt-BR")}) <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </>
      )}

      {/* Drawer com todos os posts + filtros */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl lg:max-w-5xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Todos os posts ({filtered.length.toLocaleString("pt-BR")})</SheetTitle>
            <SheetDescription>Use os filtros para refinar.</SheetDescription>
          </SheetHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
            <Select value={filterSentiment} onValueChange={setFilterSentiment}>
              <SelectTrigger><SelectValue placeholder="Sentimento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos sentimentos</SelectItem>
                <SelectItem value="positive">Positivo</SelectItem>
                <SelectItem value="negative">Negativo</SelectItem>
                <SelectItem value="neutral">Neutro</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterNetwork} onValueChange={setFilterNetwork}>
              <SelectTrigger><SelectValue placeholder="Rede" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas redes</SelectItem>
                {networks.map((n) => <SelectItem key={n} value={n} className="capitalize">{n}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} placeholder="Data" />
            <Button variant="outline" onClick={() => { setFilterSentiment("all"); setFilterNetwork("all"); setFilterDate(""); }}>
              Limpar filtros
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
            {visible.map((g) => {
              const r = g.root!;
              const ds = dominantSentiment(g);
              return (
                <Card key={g.key} className="p-3 flex flex-col gap-2 hover:border-primary/40 transition-colors cursor-pointer" onClick={() => setSelected(g)}>
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="outline" className="text-[10px]">{r?.social_network || "?"}</Badge>
                    <Badge className={`text-[10px] border ${ds.color}`}><ds.Icon className="h-3 w-3 mr-1" />{ds.label}</Badge>
                  </div>
                  <p className="text-xs line-clamp-3 min-h-[3.6em]">{r?.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}</p>
                  <div className="text-[10px] text-muted-foreground truncate">{r?.comment_author || "anônimo"} • {g.children.length} respostas</div>
                  <div className="flex justify-between text-xs pt-2 border-t mt-auto">
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{g.likes.toLocaleString("pt-BR")}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{g.replies.toLocaleString("pt-BR")}</span>
                    <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{g.shares.toLocaleString("pt-BR")}</span>
                  </div>
                </Card>
              );
            })}
          </div>

          {visibleCount < filtered.length && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              <Button variant="outline" onClick={() => setVisibleCount((n) => Math.min(n + 50, filtered.length))}>
                Carregar mais ({filtered.length - visibleCount} restantes)
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Detalhe individual */}
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

function KpiBox({ label, value, highlight = false, tone }: { label: string; value: number; highlight?: boolean; tone?: "pos" | "neg" | "neu" }) {
  const toneClass = tone === "pos" ? "bg-success/10 border-success/30" : tone === "neg" ? "bg-destructive/10 border-destructive/30" : tone === "neu" ? "bg-warning/10 border-warning/30" : highlight ? "bg-primary/10 border-primary/30" : "bg-muted/40";
  return (
    <div className={`p-3 rounded-lg border ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-bold mt-0.5">{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}
