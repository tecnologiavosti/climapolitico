import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

function Inner() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-security"],
    queryFn: async () => {
      const { data: banned } = await supabase
        .from("profiles")
        .select("id, full_name, ban_reason, banned_at")
        .eq("is_banned", true)
        .order("banned_at", { ascending: false });
      return { banned: banned ?? [] };
    },
  });

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Segurança</h1>
      <Card>
        <CardHeader><CardTitle>Usuários banidos</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-32" /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Motivo</TableHead><TableHead>Quando</TableHead></TableRow></TableHeader>
              <TableBody>
                {data?.banned.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.full_name ?? u.id.slice(0,8)}</TableCell>
                    <TableCell>{u.ban_reason ?? "—"}</TableCell>
                    <TableCell>{u.banned_at ? new Date(u.banned_at).toLocaleString("pt-BR") : "—"}</TableCell>
                  </TableRow>
                ))}
                {!data?.banned.length && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">Nenhum banimento ativo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">Logins por IP, tentativas falhas e ban de IP serão habilitados na Fase 3.</p>
    </div>
  );
}

export default function AdminSecurity() { return <AdminRoute><Inner /></AdminRoute>; }
