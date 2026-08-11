import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageLoader } from "@/components/ui/page-loader";
import {
  LayoutDashboard,
  Users,
  CreditCard,
  Wallet,
  UserCheck,
  BarChart3,
  Shield,
  Activity,
  Settings as SettingsIcon,
  Search,
} from "lucide-react";

// Reuse existing admin pages — each already provides its own UI; we mount them inside tabs.
const AdminDashboard = lazy(() => import("./AdminDashboard"));
const AdminUsers = lazy(() => import("../AdminUsers"));
const AdminSubscriptions = lazy(() => import("./AdminSubscriptions"));
const AdminPlans = lazy(() => import("./AdminPlans"));
const AdminFinance = lazy(() => import("./AdminFinance"));
const AdminCandidates = lazy(() => import("./AdminCandidates"));
const AdminAnalytics = lazy(() => import("./AdminAnalytics"));
const AdminSecurity = lazy(() => import("./AdminSecurity"));
const AdminLogs = lazy(() => import("./AdminLogs"));
const AdminSystem = lazy(() => import("./AdminSystem"));
const AdminApiSettings = lazy(() => import("../AdminApiSettings"));
const AdminSettings = lazy(() => import("./AdminSettings"));
const AdminSeoComplete = lazy(() => import("./AdminSeoComplete"));

const TABS = [
  { value: "overview", label: "Visão Geral", icon: LayoutDashboard, El: AdminDashboard },
  { value: "users", label: "Usuários", icon: Users, El: AdminUsers },
  { value: "subscriptions", label: "Assinaturas", icon: CreditCard, El: AdminSubscriptions },
  { value: "plans", label: "Planos", icon: CreditCard, El: AdminPlans },
  { value: "finance", label: "Financeiro", icon: Wallet, El: AdminFinance },
  { value: "candidates", label: "Candidatos", icon: UserCheck, El: AdminCandidates },
  { value: "analytics", label: "Analytics", icon: BarChart3, El: AdminAnalytics },
  { value: "security", label: "Segurança", icon: Shield, El: AdminSecurity },
  { value: "logs", label: "Logs", icon: Activity, El: AdminLogs },
  { value: "system", label: "Sistema", icon: SettingsIcon, El: AdminSystem },
  { value: "api", label: "APIs", icon: SettingsIcon, El: AdminApiSettings },
  { value: "seo", label: "SEO", icon: Search, El: AdminSeoComplete },
  { value: "settings", label: "Configurações", icon: SettingsIcon, El: AdminSettings },
];

function Inner() {
  const [params, setParams] = useSearchParams();
  const current = params.get("tab") || "overview";

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <Tabs
        value={current}
        onValueChange={(v) => {
          const next = new URLSearchParams(params);
          next.set("tab", v);
          setParams(next, { replace: true });
        }}
      >
        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-0">
            <Suspense fallback={<PageLoader />}>
              <t.El />
            </Suspense>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

export default function AdminCenter() {
  return (
    <AdminRoute>
      <Inner />
    </AdminRoute>
  );
}
