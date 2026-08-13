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
  KeyRound, LogIn, Clock, Plus, Crown, Zap, RotateCcw, Search, Calendar,
  Activity, ArrowUpRight
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { UserEditDialog } from "@/components/admin/UserEditDialog";
import { CreateUserDialog } from "@/components/admin/CreateUserDialog";
import { useMemo, useState } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area
} from "recharts";
import { format, startOfDay, subDays, eachDayOfInterval, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";

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
  const [showAnalytics, setShowAnalytics] = useState(false);

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

  const analyticsData = useMemo(() => {
    if (!users) return null;

    const last30Days = eachDayOfInterval({
      start: subDays(new Date(), 30),
      end: new Date(),
    });

    const growthData = last30Days.map(date => {
      const formattedDate = format(date, "dd/MM", { locale: ptBR });
      const newUsers = users.filter(u => isSameDay(new Date(u.created_at), date)).length;
      const totalToDate = users.filter(u => new Date(u.created_at) <= date).length;
      
      return {
        name: formattedDate,
        novos: newUsers,
        total: totalToDate,
      };
    });

    const tierDistribution = [
      { name: "Free", value: users.filter(u => !u.subscription || u.subscription.tier === "free").length, color: "#94a3b8" },
      { name: "Starter", value: users.filter(u => u.subscription?.tier === "starter").length, color: "#3b82f6" },
      { name: "Pro", value: users.filter(u => u.subscription?.tier === "pro").length, color: "#8b5cf6" },
      { name: "Enterprise", value: users.filter(u => u.subscription?.tier === "enterprise").length, color: "#f59e0b" },
      { name: "Vitalício", value: users.filter(u => u.subscription?.tier === "lifetime").length, color: "#10b981" },
      { name: "VIP", value: users.filter(u => u.subscription?.tier === "vip").length, color: "#ec4899" },
    ].filter(t => t.value > 0);

    const activeLast24h = users.filter(u => {
      // Mocking recent access as we don't have last_sign_in_at in profiles yet
      // In a real scenario, we'd query auth.users or a custom session log
      // For now, let's show "recently created" as a placeholder or just random
      return new Date(u.created_at) > subDays(new Date(), 1);
    }).length;

    return { growthData, tierDistribution, activeLast24h };
  }, [users]);

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

      <div className="flex items-center gap-2 p-1 bg-muted/50 rounded-lg w-fit">
        <Button 
          variant={!showAnalytics ? "secondary" : "ghost"} 
          size="sm" 
          onClick={() => setShowAnalytics(false)}
          className="gap-2"
        >
          <Users className="h-4 w-4" /> Usuários
        </Button>
        <Button 
          variant={showAnalytics ? "secondary" : "ghost"} 
          size="sm" 
          onClick={() => setShowAnalytics(true)}
          className="gap-2"
        >
          <BarChart3 className="h-4 w-4" /> Analytics
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Total Usuários</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalUsers}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Novos (24h)</CardTitle><Activity className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{analyticsData?.activeLast24h}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Assinaturas Ativas</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.activePlans}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between pb-2"><CardTitle className="text-sm">Conversão</CardTitle><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.totalUsers > 0 ? ((stats.activePlans / stats.totalUsers) * 100).toFixed(1) : 0}%</div></CardContent></Card>
      </div>

      {showAnalytics && analyticsData ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="col-span-1 md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Crescimento da Base</CardTitle>
              <CardDescription>Evolução total de usuários nos últimos 30 dias</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analyticsData.growthData}>
                  <defs>
                    <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Area type="monotone" dataKey="total" name="Total" stroke="#3b82f6" fillOpacity={1} fill="url(#colorTotal)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Plus className="h-5 w-5 text-primary" /> Novos Usuários Diários</CardTitle>
              <CardDescription>Cadastros realizados dia a dia</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analyticsData.growthData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                  <Tooltip 
                    cursor={{fill: '#f1f5f9'}}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Bar dataKey="novos" name="Novos" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" /> Distribuição de Planos</CardTitle>
              <CardDescription>Composição da base por nível de assinatura</CardDescription>
            </CardHeader>
            <CardContent className="h-[250px] flex items-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analyticsData.tierDistribution}
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {analyticsData.tierDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground font-bold text-xl">
                    {stats.totalUsers}
                  </text>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 ml-4">
                {analyticsData.tierDistribution.map((t) => (
                  <div key={t.name} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-full" style={{backgroundColor: t.color}} />
                    <span className="font-medium">{t.name}:</span>
                    <span className="text-muted-foreground">{t.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Gestão de Usuários</CardTitle>
                <CardDescription>{filtered.length} usuário(s) encontrados</CardDescription>
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
                            <DropdownMenuItem
                              className="text-amber-600 focus:text-amber-600"
                              onClick={() => action.mutate({ action: "change_plan", target_user_id: user.id, tier: "vip" })}
                            >
                              <Crown className="h-4 w-4 mr-2" /> Conceder VIP (acesso total)
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
