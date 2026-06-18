import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function Inner() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Configurações ADM</h1>
      <Card>
        <CardHeader><CardTitle>Ações administrativas</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Configurações globais da plataforma. Em construção.
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSettings() { return <AdminRoute><Inner /></AdminRoute>; }
