import { NavLink } from "@/components/NavLink";
import { Link, useLocation } from "react-router-dom";
import {
  Shield,
  FileText,
  Eye,
  Activity,
  BarChart3,
  Key,
  Database,
  ArrowLeft,
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

type AdminItem = { title: string; url: string; icon: LucideIcon };

const adminItems: AdminItem[] = [
  { title: "Painel Administrativo", url: "/dashboard/admin", icon: Shield },
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

export function AdminSidebar() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";
  const { pathname } = useLocation();

  return (
    <Sidebar className={isCollapsed ? "w-14" : "w-[17rem]"}>
      <SidebarContent>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-primary rounded-lg">
              <Shield className="h-5 w-5 text-white" />
            </div>
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
          {!isCollapsed && <SidebarGroupLabel>Administração</SidebarGroupLabel>}
          <SidebarGroupContent>
            <SidebarMenu>
              {adminItems.map((item) => {
                const active =
                  item.url === "/dashboard/admin"
                    ? pathname === item.url
                    : pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={active}>
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard/admin"}
                        className="group flex items-center gap-3 hover:bg-muted/60 px-2 py-1.5 rounded-md"
                        activeClassName="bg-muted text-primary font-semibold"
                        title={isCollapsed ? item.title : undefined}
                      >
                        <div className="p-1.5 bg-muted/60 rounded-md group-hover:bg-muted">
                          <item.icon className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                        {!isCollapsed && (
                          <span className="font-medium text-sm leading-snug flex-1 min-w-0">
                            {item.title}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
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
