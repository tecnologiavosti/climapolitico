import { NavLink as RRNavLink, Link, useLocation } from "react-router-dom";
import {
  Shield,
  FileText,
  Eye,
  Activity,
  BarChart3,
  Key,
  Database,
  ArrowLeft,
  LayoutDashboard,
  Users,
  CreditCard,
  Wallet,
  UserCheck,
  Settings as SettingsIcon,
  Search,
  type LucideIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type AdminItem = { title: string; url: string; icon: LucideIcon; tab?: string };

const adminTabs: AdminItem[] = [
  { title: "Visão Geral", url: "/dashboard/admin?tab=overview", icon: LayoutDashboard, tab: "overview" },
  { title: "Usuários", url: "/dashboard/admin?tab=users", icon: Users, tab: "users" },
  { title: "Assinaturas", url: "/dashboard/admin?tab=subscriptions", icon: CreditCard, tab: "subscriptions" },
  { title: "Planos", url: "/dashboard/admin?tab=plans", icon: CreditCard, tab: "plans" },
  { title: "Financeiro", url: "/dashboard/admin?tab=finance", icon: Wallet, tab: "finance" },
  { title: "Candidatos", url: "/dashboard/admin?tab=candidates", icon: UserCheck, tab: "candidates" },
  { title: "Analytics", url: "/dashboard/admin?tab=analytics", icon: BarChart3, tab: "analytics" },
  { title: "Segurança", url: "/dashboard/admin?tab=security", icon: Shield, tab: "security" },
  { title: "Logs", url: "/dashboard/admin?tab=logs", icon: Activity, tab: "logs" },
  { title: "Sistema", url: "/dashboard/admin?tab=system", icon: SettingsIcon, tab: "system" },
  { title: "APIs", url: "/dashboard/admin?tab=api", icon: SettingsIcon, tab: "api" },
  { title: "SEO", url: "/dashboard/admin?tab=seo", icon: Search, tab: "seo" },
  { title: "Configurações", url: "/dashboard/admin?tab=settings", icon: SettingsIcon, tab: "settings" },
];

const adminTools: AdminItem[] = [
  { title: "Blog IA", url: "/dashboard/admin/blog", icon: FileText },
  { title: "Observabilidade", url: "/dashboard/observability", icon: Eye },
  { title: "Operations Console", url: "/dashboard/operations", icon: Activity },
  { title: "SLO & SLA", url: "/dashboard/slo", icon: BarChart3 },
  { title: "Worker Tokens", url: "/dashboard/worker-tokens", icon: Key },
  { title: "Tenant Analytics", url: "/dashboard/tenant-analytics", icon: BarChart3 },
  { title: "Diagnóstico de Dados", url: "/dashboard/data-diagnostics", icon: Database },
  { title: "Saúde dos Coletores", url: "/dashboard/collector-health", icon: Activity },
  { title: "Enriquecimento de Dados", url: "/dashboard/data-enrichment", icon: Database },
];

function Row({ item, active, collapsed }: { item: AdminItem; active: boolean; collapsed: boolean }) {
  return (
    <RRNavLink
      to={item.url}
      className={cn(
        "group flex items-center gap-3 hover:bg-muted/60 px-2 py-1.5 rounded-md",
        active && "bg-muted text-primary font-semibold",
      )}
      title={collapsed ? item.title : undefined}
    >
      <div className="p-1.5 bg-muted/60 rounded-md group-hover:bg-muted">
        <item.icon className="h-4 w-4 shrink-0 text-primary" />
      </div>
      {!collapsed && (
        <span className="font-medium text-sm leading-snug flex-1 min-w-0">{item.title}</span>
      )}
    </RRNavLink>
  );
}

export function AdminSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const currentTab = searchParams.get("tab") || "overview";
  const onAdminCenter = location.pathname === "/dashboard/admin";

  return (
    <Sidebar className={isCollapsed ? "w-14" : "w-[17rem]"}>
      <SidebarContent>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2.5">
            <img
              src={logoAsset.url}
              alt="Clima Político"
              className={`brand-logo rounded-full object-contain ring-1 ring-border shrink-0 ${isCollapsed ? "h-[34px] w-[34px]" : "h-[42px] w-[42px]"}`}
            />
            {!isCollapsed && (
              <div className="min-w-0">
                <div className="font-bold text-base leading-tight">Painel ADM</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Clima Político
                </div>
              </div>
            )}
          </div>
        </div>

        <SidebarGroup>
          {!isCollapsed && <SidebarGroupLabel>Painel Administrativo</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {adminTabs.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <Row
                      item={item}
                      collapsed={isCollapsed}
                      active={onAdminCenter && currentTab === item.tab}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          {!isCollapsed && <SidebarGroupLabel>Ferramentas</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {adminTools.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <Row
                      item={item}
                      collapsed={isCollapsed}
                      active={location.pathname.startsWith(item.url)}
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <div className="mt-auto p-3 border-t">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-muted/60 text-muted-foreground hover:text-foreground"
            title={isCollapsed ? "Voltar ao app" : undefined}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span>Voltar ao app</span>}
          </Link>
        </div>
      </SidebarContent>
    </Sidebar>
  );
}
