import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, MessageSquare, ThumbsUp, Reply, Share2, Activity, Loader2 } from "lucide-react";
import { format, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface Interaction {
  id: string;
  candidate_id: string | null;
  comment_author: string | null;
  comment_text: string | null;
  sentiment_label: string | null;
  sentiment_score: number | null;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  social_network: string | null;
  post_id: string | null;
  root_comment_id: string | null;
  parent_comment_id: string | null;
  external_id: string | null;
  original_posted_at: string | null;
  created_at: string | null;
}

interface TreeNode { node: Interaction; children: TreeNode[]; }

interface Thread {
  root: Interaction;
  tree: TreeNode[];
  allDescendants: Interaction[];
  totalReplies: number;
  pos: number;
  neg: number;
  neu: number;
  totalLikes: number;
  totalShares: number;
  repercussion: string;
}

const SELECT = "id, candidate_id, comment_author, comment_text, sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, post_id, root_comment_id, parent_comment_id, external_id, original_posted_at, created_at";

function sentimentBadge(label: string | null) {
  const l = (label || "").toLowerCase();
  if (l.startsWith("pos")) return <Badge className="bg-emerald-500/15 text-emerald-700">Positivo</Badge>;
  if (l.startsWith("neg")) return <Badge className="bg-rose-500/15 text-rose-700">Negativo</Badge>;
  return <Badge variant="secondary">Neutro</Badge>;
}

function buildTree(root: Interaction, all: Interaction[]) {
  const byParent = new Map<string, Interaction[]>();
  for (const i of all) {
    const key = i.parent_comment_id || i.root_comment_id || "";
    if (!key || i.id === root.id) continue;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(i);
  }
  const descendants: Interaction[] = [];
  const visited = new Set<string>([root.id]);
  function recurse(parentId: string): TreeNode[] {
    const kids = byParent.get(parentId) || [];
    return kids.filter((k) => !visited.has(k.id)).map((k) => {
      visited.add(k.id);
      descendants.push(k);
      return { node: k, children: recurse(k.id) };
    });
  }
  const seedKeys = [root.id, root.post_id, root.external_id, root.root_comment_id].filter(Boolean) as string[];
  const tree: TreeNode[] = [];
  for (const k of seedKeys) tree.push(...recurse(k));
  return { tree, descendants };
}

function computeRepercussion(t: Omit<Thread, "repercussion">) {
  const total = t.pos + t.neg + t.neu;
  if (total === 0) return "Sem repercussão analisada.";
  const negPct = Math.round((t.neg / total) * 100);
  const posPct = Math.round((t.pos / total) * 100);
  if (t.totalReplies >= 50 && Math.abs(posPct - negPct) <= 15) return `Polarização — ${t.totalReplies} respostas (${posPct}% pos / ${negPct}% neg).`;
  if (negPct >= 60) return `Majoritariamente negativa (${negPct}%).`;
  if (posPct >= 60) return `Consenso positivo (${posPct}%).`;
  if (t.totalReplies >= 20) return `Engajada — ${t.totalReplies} respostas, equilibrada.`;
  return `Limitada (${t.totalReplies} respostas).`;
}

export default function CommentTree() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [network, setNetwork] = useState<string>("all");
  const [days, setDays] = useState<number>(7);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pageSize, setPageSize] = useState(20);

  const { data: candidates } = useQuery({
    queryKey: ["ct-candidates", user?.id, isAdmin],
    queryFn: async () => {
      let q = supabase.from("candidates").select("id, full_name").eq("status", "active");
      if (!isAdmin && user) q = q.eq("user_id", user.id);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Etapa 1: Buscar APENAS comentários raiz (paginado/janela temporal — rápido)
  const { data: roots, isLoading: loadingRoots } = useQuery({
    queryKey: ["ct-roots", user?.id, isAdmin, candidateId, network, days],
    queryFn: async () => {
      if (!user) return [] as Interaction[];
      const since = subDays(new Date(), days).toISOString();
      let q = supabase
        .from("social_interactions")
        .select(SELECT)
        .gte("collected_at", since)
        .is("parent_comment_id", null)
        .is("root_comment_id", null)
        .order("original_posted_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (!isAdmin) q = q.eq("user_id", user.id);
      if (candidateId !== "all") q = q.eq("candidate_id", candidateId);
      if (network !== "all") q = q.eq("social_network", network);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Interaction[];
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  // Etapa 2: Buscar respostas (sub-conjunto: respostas dentro da janela do mesmo escopo)
  const { data: replies, isLoading: loadingReplies } = useQuery({
    queryKey: ["ct-replies", user?.id, isAdmin, candidateId, network, days],
    queryFn: async () => {
      if (!user) return [] as Interaction[];
      const since = subDays(new Date(), days).toISOString();
      const out: Interaction[] = [];
      let from = 0;
      const pageSize2 = 1000;
      while (from < 10000) {
        let q = supabase
          .from("social_interactions")
          .select(SELECT)
          .gte("collected_at", since)
          .not("parent_comment_id", "is", null)
          .order("original_posted_at", { ascending: false, nullsFirst: false })
          .range(from, from + pageSize2 - 1);
        if (!isAdmin) q = q.eq("user_id", user.id);
        if (candidateId !== "all") q = q.eq("candidate_id", candidateId);
        if (network !== "all") q = q.eq("social_network", network);
        const { data, error } = await q;
        if (error || !data || data.length === 0) break;
        out.push(...(data as Interaction[]));
        if (data.length < pageSize2) break;
        from += pageSize2;
      }
      return out;
    },
    enabled: !!user && !!roots && roots.length > 0,
    staleTime: 60_000,
  });

  const threads = useMemo<Thread[]>(() => {
    if (!roots) return [];
    const all = [...(roots || []), ...(replies || [])];
    const result: Thread[] = [];
    for (const root of roots) {
      const { tree, descendants } = buildTree(root, all);
      let pos = 0, neg = 0, neu = 0, totalLikes = 0, totalShares = 0;
      for (const d of [root, ...descendants]) {
        const l = (d.sentiment_label || "").toLowerCase();
        if (l.startsWith("pos")) pos++; else if (l.startsWith("neg")) neg++; else neu++;
        totalLikes += d.likes_count || 0;
        totalShares += d.shares_count || 0;
      }
      const base = { root, tree, allDescendants: descendants, totalReplies: descendants.length, pos, neg, neu, totalLikes, totalShares };
      result.push({ ...base, repercussion: computeRepercussion(base) });
    }
    return result.sort((a, b) => (b.totalReplies + b.totalLikes) - (a.totalReplies + a.totalLikes));
  }, [roots, replies]);

  const networks = useMemo(() => {
    const s = new Set<string>();
    roots?.forEach((i) => i.social_network && s.add(i.social_network));
    return Array.from(s).sort();
  }, [roots]);

  const visibleThreads = threads.slice(0, pageSize);
  const isLoading = loadingRoots;
  const totalReplies = (replies?.length || 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Árvore de Comentários</h1>
        <p className="text-muted-foreground">
          Posts raiz + respostas + subcomentários em todos os níveis. Carregamento progressivo.
        </p>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <Select value={candidateId} onValueChange={(v) => { setCandidateId(v); setPageSize(20); }}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Candidato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os candidatos</SelectItem>
            {candidates?.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={network} onValueChange={(v) => { setNetwork(v); setPageSize(20); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as redes</SelectItem>
            {networks.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(days)} onValueChange={(v) => { setDays(Number(v)); setPageSize(20); }}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Últimos 3 dias</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="14">Últimos 14 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-auto flex items-center gap-2">
          {loadingReplies && <Loader2 className="h-3 w-3 animate-spin" />}
          {threads.length} thread(s) • {roots?.length || 0} raiz + {totalReplies} resp.
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : threads.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhum post raiz encontrado nesta janela. Tente ampliar para 14 ou 30 dias.
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {visibleThreads.map((t) => {
              const key = t.root.id;
              const isOpen = !!expanded[key];
              return (
                <Card key={key} className="p-4">
                  <div className="flex items-start gap-3">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-7 w-7"
                      onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                      disabled={t.tree.length === 0}
                    >
                      {t.tree.length === 0
                        ? <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        : isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </Button>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1 text-sm">
                        <span className="font-semibold">{t.root.comment_author || "Anônimo"}</span>
                        <Badge variant="outline" className="text-xs">{t.root.social_network}</Badge>
                        {sentimentBadge(t.root.sentiment_label)}
                        <span className="text-muted-foreground text-xs ml-auto">
                          {t.root.original_posted_at ? format(new Date(t.root.original_posted_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : ""}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap break-words">
                        {t.root.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}
                      </p>
                      <div className="flex gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{Number(t.totalLikes ?? 0).toLocaleString("pt-BR")}</span>
                        <span className="flex items-center gap-1"><Reply className="h-3 w-3" />{t.totalReplies} respostas</span>
                        <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{t.totalShares}</span>
                        <span>·</span>
                        <span className="text-emerald-600">{t.pos} pos</span>
                        <span className="text-rose-600">{t.neg} neg</span>
                        <span>{t.neu} neu</span>
                      </div>
                      {t.totalReplies > 0 && (
                        <div className="mt-2 flex items-start gap-2 text-xs bg-muted/40 rounded-md p-2">
                          <Activity className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                          <span><strong>Repercussão:</strong> {t.repercussion}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {isOpen && t.tree.length > 0 && (
                    <div className="mt-4 ml-10">
                      <ReplyTimeline root={t.root} descendants={t.allDescendants} />
                      <div className="space-y-2 border-l-2 border-muted pl-4 mt-3">
                        {t.tree.map((n) => <TreeNodeView key={n.node.id} node={n} depth={0} />)}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>

          {pageSize < threads.length && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setPageSize((n) => n + 20)}>
                Carregar mais ({threads.length - pageSize} restantes)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TreeNodeView({ node, depth }: { node: TreeNode; depth: number }) {
  const [showChildren, setShowChildren] = useState(depth < 1);
  return (
    <div className={depth > 0 ? "border-l border-muted pl-3" : ""}>
      <div className="text-sm py-1">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-medium text-xs">{node.node.comment_author || "Anônimo"}</span>
          {sentimentBadge(node.node.sentiment_label)}
          <span className="text-muted-foreground text-[10px] ml-auto">
            {node.node.original_posted_at ? format(new Date(node.node.original_posted_at), "dd/MM HH:mm", { locale: ptBR }) : ""}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-foreground/90 text-xs">
          {node.node.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}
        </p>
        <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground items-center">
          <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{node.node.likes_count || 0}</span>
          {node.children.length > 0 && (
            <Button variant="ghost" size="sm" className="h-5 px-1 text-[10px]" onClick={() => setShowChildren((v) => !v)}>
              {showChildren ? "Ocultar" : `Ver ${node.children.length} subcomentários`}
            </Button>
          )}
        </div>
      </div>
      {showChildren && node.children.length > 0 && (
        <div className="ml-3 space-y-1">
          {node.children.map((c) => <TreeNodeView key={c.node.id} node={c} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
}

function ReplyTimeline({ root, descendants }: { root: Interaction; descendants: Interaction[] }) {
  const data = useMemo(() => {
    const rootTs = new Date(root.original_posted_at || root.created_at || 0).getTime();
    const buckets = new Map<number, number>();
    for (const d of descendants) {
      const ts = new Date(d.original_posted_at || d.created_at || 0).getTime();
      const hours = Math.max(0, Math.round((ts - rootTs) / 3_600_000));
      buckets.set(hours, (buckets.get(hours) || 0) + 1);
    }
    return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([h, count]) => ({ hour: `+${h}h`, count }));
  }, [root, descendants]);
  if (data.length < 2) return null;
  return (
    <div className="bg-muted/20 rounded-md p-2">
      <p className="text-[10px] text-muted-foreground mb-1">Timeline de respostas após o comentário raiz</p>
      <ResponsiveContainer width="100%" height={100}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="hour" tick={{ fontSize: 9 }} />
          <YAxis tick={{ fontSize: 9 }} />
          <Tooltip contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }} />
          <Line type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
