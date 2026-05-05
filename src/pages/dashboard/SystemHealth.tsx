import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Navigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";

interface LogRow {
  id: string;
  function_name: string;
  status: "success" | "error" | "partial";
  error_message: string | null;
  duration_ms: number | null;
  executed_at: string;
}

const statusBadge = (s: LogRow["status"]) => {
  if (s === "success") return <Badge className="bg-green-600/20 text-green-700 dark:text-green-400 border-green-600/30"><CheckCircle2 className="mr-1 h-3 w-3" />OK</Badge>;
  if (s === "partial") return <Badge variant="outline" className="text-warning border-warning/40"><AlertCircle className="mr-1 h-3 w-3" />Parcial</Badge>;
  return <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" />Erro</Badge>;
};

export default function SystemHealth() {
  const { isAdmin, loading } = useAdminCheck();

  const { data, isLoading } = useQuery({
    queryKey: ["edge-function-logs"],
    queryFn: async (): Promise<LogRow[]> => {
      const { data, error } = await supabase
        .from("edge_function_logs")
        .select("id, function_name, status, error_message, duration_ms, executed_at")
        .order("executed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as LogRow[]) || [];
    },
    enabled: !!isAdmin,
    refetchInterval: 60_000,
  });

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  const byFunction = (data || []).reduce<Record<string, LogRow>>((acc, row) => {
    if (!acc[row.function_name]) acc[row.function_name] = row;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Activity className="h-8 w-8 text-primary" />
          Saúde do Sistema
        </h1>
        <p className="text-muted-foreground">Status das funções de servidor (últimas 200 execuções).</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Status atual por função</CardTitle>
          <CardDescription>Última execução de cada função registrada.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : Object.keys(byFunction).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {Object.values(byFunction).map((row) => (
                <div key={row.function_name} className="flex items-center justify-between border rounded-md p-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.function_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(row.executed_at), "dd/MM HH:mm", { locale: ptBR })}
                      {row.duration_ms != null && ` · ${row.duration_ms}ms`}
                    </p>
                  </div>
                  {statusBadge(row.status)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Últimas execuções</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="py-2 pr-4">Função</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Duração</th>
                    <th className="py-2 pr-4">Quando</th>
                    <th className="py-2 pr-4">Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {(data || []).slice(0, 100).map((row) => (
                    <tr key={row.id} className="border-b hover:bg-muted/30">
                      <td className="py-2 pr-4 font-mono text-xs">{row.function_name}</td>
                      <td className="py-2 pr-4">{statusBadge(row.status)}</td>
                      <td className="py-2 pr-4">{row.duration_ms != null ? `${row.duration_ms}ms` : "—"}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {format(new Date(row.executed_at), "dd/MM HH:mm:ss", { locale: ptBR })}
                      </td>
                      <td className="py-2 pr-4 text-xs text-destructive max-w-xs truncate" title={row.error_message ?? ""}>
                        {row.error_message ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
