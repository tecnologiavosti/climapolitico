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
import { ChevronDown, ChevronRight, MessageSquare, ThumbsUp, Reply } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Interaction {
  id: string;
  candidate_id: string | null;
  comment_author: string | null;
  comment_text: string | null;
  sentiment_label: string | null;
  sentiment_score: number | null;
  likes_count: number | null;
  replies_count: number | null;
  social_network: string | null;
  post_id: string | null;
  root_comment_id: string | null;
  parent_comment_id: string | null;
  external_id: string | null;
  original_posted_at: string | null;
  created_at: string | null;
}

interface ThreadNode {
  root: Interaction;
  replies: Interaction[];
}

function sentimentBadge(label: string | null) {
  const l = (label || "").toLowerCase();
  if (l.startsWith("pos")) return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20">Positivo</Badge>;
  if (l.startsWith("neg")) return <Badge className="bg-rose-500/15 text-rose-700 hover:bg-rose-500/20">Negativo</Badge>;
  return <Badge variant="secondary">Neutro</Badge>;
}

export default function CommentTree() {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [candidateId, setCandidateId] = useState<string>("all");
  const [network, setNetwork] = useState<string>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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

  const { data: interactions, isLoading } = useQuery({
    queryKey: ["ct-interactions", user?.id, isAdmin, candidateId, network],
    queryFn: async () => {
      if (!user) return [] as Interaction[];
      let q = supabase
        .from("social_interactions")
        .select("id, candidate_id, comment_author, comment_text, sentiment_label, sentiment_score, likes_count, replies_count, social_network, post_id, root_comment_id, parent_comment_id, external_id, original_posted_at, created_at")
        .order("original_posted_at", { ascending: false, nullsFirst: false })
        .limit(1000);
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

  const threads = useMemo<ThreadNode[]>(() => {
    if (!interactions) return [];
    const byPost: Record<string, Interaction[]> = {};
    interactions.forEach((i) => {
      const key = i.post_id || i.root_comment_id || i.external_id || i.id;
      (byPost[key] = byPost[key] || []).push(i);
    });
    const result: ThreadNode[] = [];
    Object.values(byPost).forEach((items) => {
      // Root = sem parent_comment_id e sem root_comment_id (ou o mais antigo)
      const sorted = [...items].sort((a, b) => {
        const da = new Date(a.original_posted_at || a.created_at || 0).getTime();
        const db = new Date(b.original_posted_at || b.created_at || 0).getTime();
        return da - db;
      });
      const rootIdx = sorted.findIndex((i) => !i.parent_comment_id && !i.root_comment_id);
      const root = rootIdx >= 0 ? sorted[rootIdx] : sorted[0];
      const replies = sorted.filter((i) => i.id !== root.id);
      result.push({ root, replies });
    });
    return result.sort((a, b) => (b.replies.length + (b.root.likes_count || 0)) - (a.replies.length + (a.root.likes_count || 0))).slice(0, 100);
  }, [interactions]);

  const networks = useMemo(() => {
    const s = new Set<string>();
    interactions?.forEach((i) => i.social_network && s.add(i.social_network));
    return Array.from(s).sort();
  }, [interactions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Árvore de Comentários</h1>
        <p className="text-muted-foreground">Posts raiz e suas respostas agrupados por publicação. Identifique conversas que estão bombando.</p>
      </div>

      <Card className="p-4 flex flex-wrap gap-3 items-center">
        <Select value={candidateId} onValueChange={setCandidateId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Candidato" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os candidatos</SelectItem>
            {candidates?.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={network} onValueChange={setNetwork}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Rede social" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as redes</SelectItem>
            {networks.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="text-sm text-muted-foreground ml-auto">
          {threads.length} thread(s) — {interactions?.length || 0} interações
        </div>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : threads.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          Nenhum comentário encontrado com esses filtros.
        </Card>
      ) : (
        <div className="space-y-3">
          {threads.map(({ root, replies }) => {
            const key = root.id;
            const isOpen = !!expanded[key];
            return (
              <Card key={key} className="p-4">
                <div className="flex items-start gap-3">
                  <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))} disabled={replies.length === 0}>
                    {replies.length === 0 ? <MessageSquare className="h-4 w-4 text-muted-foreground" /> : isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </Button>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1 text-sm">
                      <span className="font-semibold">{root.comment_author || "Anônimo"}</span>
                      <Badge variant="outline" className="text-xs">{root.social_network}</Badge>
                      {sentimentBadge(root.sentiment_label)}
                      <span className="text-muted-foreground text-xs ml-auto">
                        {root.original_posted_at ? format(new Date(root.original_posted_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : ""}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words">{root.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}</p>
                    <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{root.likes_count || 0}</span>
                      <span className="flex items-center gap-1"><Reply className="h-3 w-3" />{replies.length} respostas</span>
                    </div>
                  </div>
                </div>
                {isOpen && replies.length > 0 && (
                  <div className="mt-4 ml-10 space-y-3 border-l-2 border-muted pl-4">
                    {replies.map((r) => (
                      <div key={r.id} className="text-sm">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-medium">{r.comment_author || "Anônimo"}</span>
                          {sentimentBadge(r.sentiment_label)}
                          <span className="text-muted-foreground text-xs ml-auto">
                            {r.original_posted_at ? format(new Date(r.original_posted_at), "dd/MM HH:mm", { locale: ptBR }) : ""}
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words text-foreground/90">{r.comment_text || <span className="text-muted-foreground italic">(sem texto)</span>}</p>
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{r.likes_count || 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
