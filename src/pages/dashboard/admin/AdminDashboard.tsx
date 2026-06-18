import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Users, TrendingUp, CreditCard, AlertTriangle, ShieldCheck, UserPlus, Activity, Ban } from "lucide-react";
import { AdminRoute } from "@/components/admin/AdminRoute";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type Kpi = { label: string; value: string | number; icon: any; hint?: string };

function startOfDayIso(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString();
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

function KpiCard({ label, value, icon: Icon, hint }: Kpi) {
  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </CardContent>
    </Card>
  );
}

function AdminDashboardInner() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-dashboard-kpis"],
    queryFn: async () => {
      const now = new Date();
      const todayIso = startOfDayIso(now);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

      const [
        { count: totalUsers },
        { count: newToday },
        { count: activeSubs },
        { count: bannedCount },
        { count: failedJobs },
        { data: planRows },
        { data: growthRows },
      ] = await Promise.all([
        supabase.from("profiles").select("*", { count: "exact", head: true }),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", todayIso),
        supabase.from("subscriptions").select("*", { count: "exact", head: true }).eq("status", "active"),
        supabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_banned", true),
        supabase.from("analysis_jobs").select("*", { count: "exact", head: true }).eq("status", "failed").gte("created_at", sevenDaysAgo),
        supabase.from("subscriptions").select("tier, status").eq("status", "active"),
        supabase.from("profiles").select("created_at").gte("created_at", thirtyDaysAgo).order("created_at", { ascending: true }),
      ]);

      const planCounts = new Map<string, number>();
      (planRows ?? []).forEach((r: any) => {
        planCounts.set(r.tier, (planCounts.get(r.tier) ?? 0) + 1);
      });
      const planData = Array.from(planCounts.entries()).map(([name, value]) => ({ name, value }));

      // MRR estimate (rough): pro=49, enterprise=199, lifetime/free=0
      const priceMap: Record<string, number> = { pro: 49, enterprise: 199, lifetime: 0, free: 0, trial: 0 };
      const mrr = (planRows ?? []).reduce((acc: number, r: any) => acc + (priceMap[r.tier] ?? 0), 0);

      const byDay = new Map<string, number>();
      (growthRows ?? []).forEach((r: any) => {
        const k = r.created_at.slice(0, 10);
        byDay.set(k, (byDay.get(k) ?? 0) + 1);
      });
      const growthData: { date: string; users: number }[] = [];
      let cum = 0;
      const sorted = Array.from(byDay.entries()).sort();
      for (const [date, count] of sorted) {
        cum += count;
        growthData.push({ date: date.slice(5), users: cum });
      }

      return {
        totalUsers: totalUsers ?? 0,
        newToday: newToday ?? 0,
        activeSubs: activeSubs ?? 0,
        bannedCount: bannedCount ?? 0,
        failedJobs: failedJobs ?? 0,
        mrr,
        planData,
        growthData,
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 p-6">
        <h1 className="text-3xl font-bold">Painel ADM</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </div>
    );
  }

  const kpis: Kpi[] = [
    { label: "Usuários totais", value: data.totalUsers, icon: Users },
    { label: "Novos hoje", value: data.newToday, icon: UserPlus },
    { label: "Assinantes ativos", value: data.activeSubs, icon: ShieldCheck },
    { label: "MRR estimado", value: `R$ ${data.mrr.toLocaleString("pt-BR")}`, icon: CreditCard, hint: "Estimativa por plano" },
    { label: "Banidos", value: data.bannedCount, icon: Ban },
    { label: "Jobs falhando (7d)", value: data.failedJobs, icon: AlertTriangle },
    { label: "Conversão (ativos / total)", value: data.totalUsers ? `${((data.activeSubs / data.totalUsers) * 100).toFixed(1)}%` : "0%", icon: TrendingUp },
    { label: "Status", value: "Operacional", icon: Activity },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold">Painel ADM</h1>
        <p className="text-muted-foreground">Visão geral em tempo real da plataforma.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => <KpiCard key={k.label} {...k} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Crescimento de usuários (30d)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.growthData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Line type="monotone" dataKey="users" stroke="#3b82f6" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Distribuição de planos</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.planData} dataKey="value" nameKey="name" outerRadius={80} label>
                    {data.planData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Legend />
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  return <AdminRoute><AdminDashboardInner /></AdminRoute>;
}
