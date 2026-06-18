import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Activity, Users, Zap, TrendingUp } from "lucide-react";

function fmtDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

function Inner() {
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const days = parseInt(range);
  const since = useMemo(() => new Date(Date.now() - days * 86400000).toISOString(), [days]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-analytics-full", range],
    queryFn: async () => {
      const [events, signups, subs, profiles, sessions] = await Promise.all([
        supabase.from("usage_events").select("event_type, created_at, user_id").gte("created_at", since).limit(10000),
        supabase.from("profiles").select("id, created_at").gte("created_at", since).limit(5000),
        supabase.from("subscriptions").select("tier, status, created_at").limit(5000),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
        supabase.from("usage_events").select("user_id, created_at").gte("created_at", new Date(Date.now() - 1 * 86400000).toISOString()).limit(10000),
      ]);

      // Per-day series
      const byDay: Record<string, { day: string; events: number; signups: number; active: number }> = {};
      for (let i = days - 1; i >= 0; i--) {
        const day = fmtDay(new Date(Date.now() - i * 86400000));
        byDay[day] = { day, events: 0, signups: 0, active: 0 };
      }
      const dailyActive: Record<string, Set<string>> = {};
      (events.data ?? []).forEach((e: any) => {
        const d = e.created_at?.slice(0, 10);
        if (byDay[d]) byDay[d].events++;
        if (e.user_id) {
          dailyActive[d] ??= new Set();
          dailyActive[d].add(e.user_id);
        }
      });
      Object.entries(dailyActive).forEach(([d, set]) => {
        if (byDay[d]) byDay[d].active = set.size;
      });
      (signups.data ?? []).forEach((s: any) => {
        const d = s.created_at?.slice(0, 10);
        if (byDay[d]) byDay[d].signups++;
      });

      // Event type breakdown
      const typeMap: Record<string, number> = {};
      (events.data ?? []).forEach((e: any) => {
        const t = e.event_type ?? "outros";
        typeMap[t] = (typeMap[t] ?? 0) + 1;
      });
      const topEvents = Object.entries(typeMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([name, value]) => ({ name, value }));

      // Subscription tier distribution
      const tierMap: Record<string, number> = {};
      (subs.data ?? []).forEach((s: any) => {
        if (s.status === "active" || s.status === "trialing") {
          tierMap[s.tier ?? "free"] = (tierMap[s.tier ?? "free"] ?? 0) + 1;
        }
      });
      const tierData = Object.entries(tierMap).map(([name, value]) => ({ name, value }));

      const totalEvents = (events.data ?? []).length;
      const totalSignups = (signups.data ?? []).length;
      const totalUsers = profiles.count ?? 0;
      const dau = new Set((sessions.data ?? []).map((e: any) => e.user_id).filter(Boolean)).size;

      return {
        series: Object.values(byDay),
        topEvents,
        tierData,
        totalEvents,
        totalSignups,
        totalUsers,
        dau,
      };
    },
  });

  if (isLoading || !data) {
    return (
      <div className="p-4 sm:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-80" />
      </div>
    );
  }

  const COLORS = ["#0EA5E9", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#84CC16"];

  return (
    <div className="space-y-4 p-4 sm:p-6 pb-24 md:pb-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">Métricas de uso da plataforma.</p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as any)}>
          <TabsList>
            <TabsTrigger value="7">7d</TabsTrigger>
            <TabsTrigger value="30">30d</TabsTrigger>
            <TabsTrigger value="90">90d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium">Eventos</CardTitle>
            <Zap className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent><div className="text-xl sm:text-2xl font-bold">{data.totalEvents.toLocaleString()}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium">Novos cadastros</CardTitle>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent><div className="text-xl sm:text-2xl font-bold">{data.totalSignups}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium">Total usuários</CardTitle>
            <Users className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent><div className="text-xl sm:text-2xl font-bold">{data.totalUsers}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-xs font-medium">DAU (24h)</CardTitle>
            <Activity className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent><div className="text-xl sm:text-2xl font-bold">{data.dau}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Atividade diária</CardTitle>
          <CardDescription>Eventos, cadastros e usuários ativos</CardDescription>
        </CardHeader>
        <CardContent className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data.series}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="events" stroke="#0EA5E9" strokeWidth={2} dot={false} name="Eventos" />
              <Line type="monotone" dataKey="active" stroke="#F59E0B" strokeWidth={2} dot={false} name="Ativos" />
              <Line type="monotone" dataKey="signups" stroke="#10B981" strokeWidth={2} dot={false} name="Cadastros" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Top eventos</CardTitle>
            <CardDescription>Tipos de evento mais disparados</CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topEvents} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                <Tooltip />
                <Bar dataKey="value" fill="#0EA5E9" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">Distribuição de planos</CardTitle>
            <CardDescription>Assinaturas ativas por tier</CardDescription>
          </CardHeader>
          <CardContent className="h-64 sm:h-72">
            {data.tierData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Nenhuma assinatura ativa
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={data.tierData} dataKey="value" nameKey="name" outerRadius={80} label>
                    {data.tierData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">Live</Badge>
        Dados atualizados a cada acesso. Eventos lidos da tabela <code>usage_events</code>.
      </div>
    </div>
  );
}

export default function AdminAnalytics() {
  return (
    <AdminRoute>
      <Inner />
    </AdminRoute>
  );
}
