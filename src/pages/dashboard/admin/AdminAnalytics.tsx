import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function Inner() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-analytics"],
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const [{ count: events }, { count: signups }] = await Promise.all([
        supabase.from("usage_events").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
        supabase.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", sevenDaysAgo),
      ]);
      return { events: events ?? 0, signups: signups ?? 0 };
    },
  });

  if (isLoading || !data) return <div className="p-6"><Skeleton className="h-64" /></div>;

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Analytics</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Eventos (7d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{data.events}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Signups (7d)</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{data.signups}</div></CardContent></Card>
      </div>
      <p className="text-sm text-muted-foreground">Instrumentação completa (pageviews, sessões, funil) na Fase 3.</p>
    </div>
  );
}

export default function AdminAnalytics() { return <AdminRoute><Inner /></AdminRoute>; }
