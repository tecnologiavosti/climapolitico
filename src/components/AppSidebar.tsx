import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  BarChart3,
  Users,
  TrendingUp,
  Settings,
  Brain,
  Bell,
  CreditCard,
  LineChart,
  Mic,
  Trophy,
  ThumbsDown,
  Sparkles,
  GitCompareArrows,
  Shield,
  UserX,
  Share2,
  Database,
  FileText,
  Calendar,
  ClipboardList,
  Radio,
  Key,
} from "lucide-react";
import { useAdminCheck } from "@/hooks/useAdminCheck";

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

// Módulos ativos no menu principal
const mainItems = [
  { title: "Visão Geral", url: "/dashboard", icon: BarChart3 },
  { title: "Resumo Inteligente", url: "/dashboard/candidate-summary", icon: FileText },
  { title: "Análise de Rejeição", url: "/dashboard/rejection-analysis", icon: ThumbsDown },
  { title: "Recomendações de Narrativa", url: "/dashboard/narrative-recommendations", icon: Sparkles },
  { title: "Comparação de Candidatos", url: "/dashboard/candidate-comparison", icon: GitCompareArrows },
  { title: "Monitor Tempo Real", url: "/dashboard/realtime-monitor", icon: Radio },
  { title: "Candidatos", url: "/dashboard/candidates", icon: Users },
  { title: "Analytics Avançado", url: "/dashboard/analytics-advanced", icon: LineChart },
  { title: "Ranking", url: "/dashboard/ranking", icon: Trophy },
  { title: "Configuração de Coleta", url: "/dashboard/collection-status", icon: Database },
];

// Módulos temporariamente desativados (mantidos para reativação futura)
// const inactiveItems = [
//   { title: "Análises", url: "/dashboard/analytics", icon: TrendingUp },
//   { title: "Análise de Fala", url: "/dashboard/speech-analysis", icon: Mic },
//   { title: "Público Indeciso", url: "/dashboard/undecided", icon: UserX },
//   { title: "Relatório por Rede Social", url: "/dashboard/social-media-report", icon: Share2 },
//   { title: "Relatório de Rastreabilidade", url: "/dashboard/traceability-report", icon: ClipboardList },
//   { title: "Relatórios Agendados", url: "/dashboard/scheduled-reports", icon: Calendar },
//   { title: "Templates de Relatório", url: "/dashboard/report-templates", icon: FileText },
//   { title: "IA & Insights", url: "/dashboard/ai", icon: Brain },
// ];

const adminItems = [
  { title: "Administração", url: "/dashboard/admin", icon: Shield },
  { title: "APIs & Integrações", url: "/dashboard/admin/api-settings", icon: Key },
];

const settingsItems = [
  { title: "Notificações", url: "/dashboard/notifications", icon: Bell },
  { title: "Assinatura", url: "/dashboard/subscription", icon: CreditCard },
  { title: "Configurações", url: "/dashboard/settings", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isCollapsed = state === "collapsed";
  const { isAdmin } = useAdminCheck();

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return currentPath === path;
    }
    return currentPath.startsWith(path);
  };

  return (
    <Sidebar className={isCollapsed ? "w-14" : "w-64"}>
      <SidebarContent>
        {/* Logo */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-gradient-primary rounded-lg">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            {!isCollapsed && (
              <span className="font-bold text-lg bg-gradient-primary bg-clip-text text-transparent">
                Clima Político
              </span>
            )}
          </div>
        </div>

        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild
                    data-onboarding={
                      item.url === "/dashboard" ? "overview" :
                      item.url === "/dashboard/candidates" ? "candidates" :
                      item.url === "/dashboard/ai" ? "ai-insights" :
                      undefined
                    }
                  >
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-muted/50"
                      activeClassName="bg-muted text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Admin Section */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administração</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-muted/50"
                        activeClassName="bg-muted text-primary font-medium"
                      >
                        <item.icon className="h-4 w-4" />
                        {!isCollapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Settings */}
        <SidebarGroup>
          <SidebarGroupLabel>Configurações</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-muted/50"
                      activeClassName="bg-muted text-primary font-medium"
                    >
                      <item.icon className="h-4 w-4" />
                      {!isCollapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
