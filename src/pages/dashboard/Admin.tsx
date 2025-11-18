import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Shield, Users, TrendingUp, BarChart3, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

interface UserWithDetails {
  id: string;
  full_name: string | null;
  organization: string | null;
  created_at: string;
  subscription: {
    tier: string;
    status: string;
    max_candidates: number;
    max_updates_per_month: number;
    updates_used_this_month: number;
  } | null;
  candidates_count: number;
  analyses_count: number;
  speeches_count: number;
  rankings_count: number;
}

export default function Admin() {
  const { isAdmin, isLoading: checkingAdmin } = useAdminCheck();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all users with their subscriptions and stats
  const { data: users, isLoading: loadingUsers } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      // Get profiles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, organization, created_at');

      if (profilesError) throw profilesError;

      // Get subscriptions
      const { data: subscriptions, error: subsError } = await supabase
        .from('subscriptions')
        .select('*');

      if (subsError) throw subsError;

      // Get counts for each user
      const usersWithDetails: UserWithDetails[] = await Promise.all(
        profiles.map(async (profile) => {
          const [candidates, analyses, speeches, rankings] = await Promise.all([
            supabase.from('candidates').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
            supabase.from('candidate_analyses').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
            supabase.from('speech_analyses').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
            supabase.from('candidate_rankings').select('id', { count: 'exact', head: true }).eq('user_id', profile.id),
          ]);

          const subscription = subscriptions.find(s => s.user_id === profile.id);

          return {
            ...profile,
            subscription: subscription || null,
            candidates_count: candidates.count || 0,
            analyses_count: analyses.count || 0,
            speeches_count: speeches.count || 0,
            rankings_count: rankings.count || 0,
          };
        })
      );

      return usersWithDetails;
    },
    enabled: isAdmin,
  });

  // Stats calculations
  const stats = {
    totalUsers: users?.length || 0,
    activePlans: users?.filter(u => u.subscription?.status === 'active').length || 0,
    totalAnalyses: users?.reduce((sum, u) => sum + u.analyses_count, 0) || 0,
    totalCandidates: users?.reduce((sum, u) => sum + u.candidates_count, 0) || 0,
  };

  // Update subscription tier
  const updateTierMutation = useMutation({
    mutationFn: async ({ userId, tier }: { userId: string; tier: 'basic' | 'pro' | 'enterprise' }) => {
      const { error } = await supabase
        .from('subscriptions')
        .update({ tier })
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: "Plano atualizado com sucesso" });
    },
    onError: (error) => {
      toast({ 
        title: "Erro ao atualizar plano", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Reset monthly usage
  const resetUsageMutation = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('subscriptions')
        .update({ updates_used_this_month: 0 })
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast({ title: "Contador resetado com sucesso" });
    },
    onError: (error) => {
      toast({ 
        title: "Erro ao resetar contador", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  if (checkingAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Skeleton className="h-8 w-[200px]" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Shield className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Acesso Negado</h2>
        <p className="text-muted-foreground">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Shield className="h-8 w-8" />
          Administração
        </h1>
        <p className="text-muted-foreground mt-2">
          Gerencie usuários, planos e monitore o uso da plataforma
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Usuários</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Planos Ativos</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activePlans}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Análises</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAnalyses}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Candidatos</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalCandidates}</div>
          </CardContent>
        </Card>
      </div>

      {/* Users Management Table */}
      <Card>
        <CardHeader>
          <CardTitle>Gestão de Usuários</CardTitle>
          <CardDescription>
            Visualize e gerencie todos os usuários da plataforma
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Organização</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uso Mensal</TableHead>
                  <TableHead>Candidatos</TableHead>
                  <TableHead>Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.full_name || 'Sem nome'}
                    </TableCell>
                    <TableCell>{user.organization || '-'}</TableCell>
                    <TableCell>
                      <Select
                        value={user.subscription?.tier || 'basic'}
                        onValueChange={(value) => 
                          updateTierMutation.mutate({ userId: user.id, tier: value as 'basic' | 'pro' | 'enterprise' })
                        }
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="pro">Pro</SelectItem>
                          <SelectItem value="enterprise">Enterprise</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.subscription?.status === 'active' ? 'default' : 'secondary'}>
                        {user.subscription?.status || 'inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {user.subscription?.updates_used_this_month || 0} / {user.subscription?.max_updates_per_month || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {user.candidates_count} / {user.subscription?.max_candidates || 0}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetUsageMutation.mutate(user.id)}
                        disabled={resetUsageMutation.isPending}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Resetar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detailed Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Estatísticas Detalhadas</CardTitle>
          <CardDescription>
            Breakdown de uso por usuário
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingUsers ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Candidatos</TableHead>
                  <TableHead>Análises</TableHead>
                  <TableHead>Discursos</TableHead>
                  <TableHead>Rankings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users?.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.full_name || 'Sem nome'}
                    </TableCell>
                    <TableCell>{user.candidates_count}</TableCell>
                    <TableCell>{user.analyses_count}</TableCell>
                    <TableCell>{user.speeches_count}</TableCell>
                    <TableCell>{user.rankings_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
