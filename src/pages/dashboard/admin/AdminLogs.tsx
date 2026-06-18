import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminRoute } from "@/components/admin/AdminRoute";

function Inner() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admin_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Logs administrativos</h1>
      <Card>
        <CardHeader><CardTitle>Últimas 200 ações</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-64" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Ação</TableHead>
                  <TableHead>Alvo</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((row: any) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{new Date(row.created_at).toLocaleString("pt-BR")}</TableCell>
                    <TableCell className="text-xs">{row.admin_email ?? row.admin_id}</TableCell>
                    <TableCell><Badge variant="outline">{row.action}</Badge></TableCell>
                    <TableCell className="text-xs">{row.target_type}{row.target_id ? ` · ${row.target_id}` : ""}</TableCell>
                    <TableCell className="text-xs font-mono max-w-md truncate">{JSON.stringify(row.metadata)}</TableCell>
                  </TableRow>
                ))}
                {(data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhum log registrado ainda.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLogs() {
  return <AdminRoute><Inner /></AdminRoute>;
}
