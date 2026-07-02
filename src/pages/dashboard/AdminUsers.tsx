import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Shield, Users, TrendingUp, BarChart3, MoreHorizontal, Edit, Trash2, Ban, ShieldCheck,
  KeyRound, LogIn, Clock, Plus, Crown, Zap, RotateCcw, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { UserEditDialog } from "@/components/admin/UserEditDialog";
import { CreateUserDialog } from "@/components/admin/CreateUserDialog";
import { useMemo, useState } from "react";

interface UserRow {
  id: string;
  full_name: string | null;
  organization: string | null;
  phone: string | null;
  role_title: string | null;
  party: string | null;
  admin_notes: string | null;
  created_at: string;
  is_banned: boolean;
  ban_reason: string | null;
  suspended_until: string | null;
  subscription: any;
  candidates_count: number;
  analyses_count: number;
}

function AdminUsersInner() {
  const { isAdmin, isLoading: checkingAdmin } = useAdminCheck();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<UserRow[]> => {
      const { data: profiles, error } = await supabase
        .from("profiles")
        .select("id, full_name, organization, phone, role_title, party, admin_notes, created_at, is_banned, ban_reason, suspended_until");
      if (error) throw error;
      const { data: subs } = await supabase.from("subscriptions").select("*");
      const rows = await Promise.all((profiles ?? []).map(async (p: any) => {
        const [c, a] = await Promise.all([
          supabase.from("candidates").select("id", { count: "exact", head: true }).eq("user_id", p.id),
          supabase.from("candidate_analyses").select("id", { count: "exact", head: true }).eq("user_id", p.id),
        ]);
        return {
          ...p,
          subscription: subs?.find((s: any) => s.user_id === p.id) ?? null,
          candidates_count: c.count ?? 0,
          analyses_count: a.count ?? 0,
        };
      }));
      return rows;
    },
    enabled: isAdmin,
  });

  const filtered = useMemo(() => {
    return (users ?? []).filter(u => {
      if (search) {
        const s = search.toLowerCase();
        const hay = `${u.full_name ?? ""} ${u.organization ?? ""} ${u.id}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (filterTier !== "all" && u.subscription?.tier !== filterTier) return false;
      if (filterStatus !== "all") {
        if (filterStatus === "banned" && !u.is_banned) return false;
        if (filterStatus === "active" && (u.is_banned || u.subscription?.status !== "active")) return false;
        if (filterStatus === "cancelled" && u.subscription?.status !== "cancelled") return false;
      }
      return true;
    });
  }, [users, search, filterTier, filterStatus]);

  const stats = {
    totalUsers: users?.length ?? 0,
    activePlans: users?.filter(u => u.subscription?.status === "active").length ?? 0,
    totalAnalyses: users?.reduce((s, u) => s + u.analyses_count, 0) ?? 0,
    totalCandidates: users?.reduce((s, u) => s + u.candidates_count, 0) ?? 0,
  };

  const call = async (payload: Record<string, any>) => {
    const { data, error } = await supabase.functions.invoke("admin-user-actions", { body: payload });
    if (error || (data as any)?.error) throw new Error(error?.message || (data as any)?.error || "Falha");
    return data;
  };

  const action = useMutation({
    mutationFn: call,
    onSuccess: (_, variables: any) => {
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "Ação concluída", description: variables.action });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const impersonate = useMutation({
    mutationFn: (uid: string) => call({ action: "impersonate", target_user_id: uid }),
    onSuccess: (d: any) => {
      if (d?.action_link) {
        navigator.clipboard.writeText(d.action_link).catch(() => {});
        toast({ title: "Link de impersonação copiado", description: "Cole em uma aba anônima para entrar como o usuário." });
      }
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  if (checkingAdmin) return <div className="p-6"><Skeleton className="h-8 w-48" /></div>;
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Shield className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Acesso Negado</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2"><Shield className="h-8 w-8" /> Administração</h1>
          <p className="text-muted-foreground mt-1">Gestão completa de usuários, planos e assinaturas</p>
        </div>
        <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4 mr-2" /> Criar Usuário</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Usuários</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalUsers}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Planos Ativos</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.activePlans}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Análises</CardTitle><BarChart3 className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalAnalyses}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Candidatos</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalCandidates}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>Gestão de Usuários</CardTitle>
              <CardDescription>{filtered.length} usuário(s)</CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
                <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 w-56" />
              </div>
              <Select value={filterTier} onValueChange={setFilterTier}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos planos</SelectItem>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                  <SelectItem value="lifetime">Vitalício</SelectItem>
                  <SelectItem value="vip">👑 VIP</SelectItem>
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="active">Ativos</SelectItem>
                  <SelectItem value="cancelled">Cancelados</SelectItem>
                  <SelectItem value="banned">Banidos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Organização</TableHead>
                    <TableHead>Plano</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Uso</TableHead>
                    <TableHead>Candidatos</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(user => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">{user.full_name || "Sem nome"}</div>
                        <div className="text-xs text-muted-foreground font-mono">{user.id.slice(0, 8)}…</div>
                      </TableCell>
                      <TableCell>{user.organization || "—"}</TableCell>
                      <TableCell>
                        <Select
                          value={user.subscription?.tier ?? "free"}
                          onValueChange={tier => action.mutate({ action: "change_plan", target_user_id: user.id, tier })}
                        >
                          <SelectTrigger className="w-[120px] h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="free">Free</SelectItem>
                            <SelectItem value="starter">Starter</SelectItem>
                            <SelectItem value="pro">Pro</SelectItem>
                            <SelectItem value="enterprise">Enterprise</SelectItem>
                            <SelectItem value="lifetime">Vitalício</SelectItem>
                            <SelectItem value="vip">👑 VIP</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        {user.is_banned ? <Badge variant="destructive">Banido</Badge>
                          : user.suspended_until && new Date(user.suspended_until) > new Date() ? <Badge variant="outline">Suspenso</Badge>
                          : <Badge variant={user.subscription?.status === "active" ? "default" : "secondary"}>{user.subscription?.status ?? "inactive"}</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">
                        {user.subscription?.updates_used_this_month ?? 0} / {user.subscription?.max_updates_per_month ?? 0}
                      </TableCell>
                      <TableCell className="text-sm">
                        {user.candidates_count} / {user.subscription?.max_candidates ?? 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuLabel>Ações</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setEditing(user)}>
                              <Edit className="h-4 w-4 mr-2" /> Editar usuário
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => impersonate.mutate(user.id)}>
                              <LogIn className="h-4 w-4 mr-2" /> Impersonar (copiar link)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => action.mutate({ action: "reset_password", target_user_id: user.id })}>
                              <KeyRound className="h-4 w-4 mr-2" /> Enviar reset senha
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel className="text-xs">Conceder plano</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => action.mutate({ action: "change_plan", target_user_id: user.id, tier: "pro", duration_days: 30 })}>
                              <Zap className="h-4 w-4 mr-2" /> Pro por 30 dias
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => action.mutate({ action: "change_plan", target_user_id: user.id, tier: "enterprise", duration_days: 365 })}>
                              <Crown className="h-4 w-4 mr-2" /> Enterprise 1 ano
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => action.mutate({ action: "change_plan", target_user_id: user.id, tier: "lifetime" })}>
                              <Crown className="h-4 w-4 mr-2" /> Tornar vitalício
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => action.mutate({ action: "revoke_subscription", target_user_id: user.id })}>
                              <RotateCcw className="h-4 w-4 mr-2" /> Revogar assinatura
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => {
                              const until = prompt("Suspender até (YYYY-MM-DD):");
                              if (until) action.mutate({ action: "suspend", target_user_id: user.id, until, reason: "ADM" });
                            }}>
                              <Clock className="h-4 w-4 mr-2" /> Suspender temporariamente
                            </DropdownMenuItem>
                            {user.suspended_until && (
                              <DropdownMenuItem onClick={() => action.mutate({ action: "unsuspend", target_user_id: user.id })}>
                                <ShieldCheck className="h-4 w-4 mr-2" /> Remover suspensão
                              </DropdownMenuItem>
                            )}
                            {user.is_banned ? (
                              <DropdownMenuItem onClick={() => action.mutate({ action: "unban", target_user_id: user.id })}>
                                <ShieldCheck className="h-4 w-4 mr-2" /> Desbanir
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => {
                                const reason = prompt("Motivo do banimento:") ?? "";
                                action.mutate({ action: "ban", target_user_id: user.id, reason });
                              }}>
                                <Ban className="h-4 w-4 mr-2" /> Banir
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem onSelect={e => e.preventDefault()} className="text-destructive">
                                  <Trash2 className="h-4 w-4 mr-2" /> Excluir definitivamente
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Excluir {user.full_name ?? "usuário"}?</AlertDialogTitle>
                                  <AlertDialogDescription>Esta ação remove o usuário e todos os dados associados. Irreversível.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => action.mutate({ action: "hard_delete", target_user_id: user.id })}>Excluir</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UserEditDialog open={!!editing} onOpenChange={v => !v && setEditing(null)} user={editing} />
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

export default function AdminUsers() {
  return <AdminRoute><AdminUsersInner /></AdminRoute>;
}
