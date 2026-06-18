import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AdminRoute } from "@/components/admin/AdminRoute";

const plans = [
  { tier: "free", price: 0, candidates: 1, updates: 10, features: ["Painel básico", "Sem alertas"] },
  { tier: "pro", price: 49, candidates: 5, updates: 100, features: ["Alertas", "Relatórios PDF", "Histórico 90d"] },
  { tier: "enterprise", price: 199, candidates: 25, updates: 1000, features: ["Multi-usuário", "API", "SLA"] },
  { tier: "lifetime", price: 0, candidates: 9999, updates: 9999, features: ["Acesso vitalício", "Todos os recursos"] },
];

function Inner() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">Planos</h1>
      <p className="text-muted-foreground">Visualize os planos atuais. CRUD completo será habilitado na Fase 2 (com tabela <code>subscription_plans</code>).</p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {plans.map(p => (
          <Card key={p.tier}>
            <CardHeader>
              <CardTitle className="capitalize flex items-center justify-between">
                {p.tier} <Badge>R$ {p.price}/mês</Badge>
              </CardTitle>
              <CardDescription>Candidatos: {p.candidates} · Updates/mês: {p.updates}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="text-sm space-y-1">
                {p.features.map(f => <li key={f}>• {f}</li>)}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function AdminPlans() { return <AdminRoute><Inner /></AdminRoute>; }
