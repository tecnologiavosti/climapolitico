import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  BarChart3,
  Users,
  TrendingUp,
  Settings,
  Brain,
  Bell,
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
  Import,
  BookUser,
  Database as DatabaseIcon,
  MapPinned,
  Linkedin,
  Rss,
  Network,
  MessagesSquare,
  CalendarClock,
  AlertTriangle,
} from "lucide-react";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useTooltipsEnabled } from "@/hooks/useTooltipsEnabled";

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
import { HelpTooltip } from "@/components/ui/help-tooltip";

// Módulos ativos no menu principal
const mainItems = [
  { title: "Visão Geral", url: "/dashboard", icon: BarChart3, tip: "Tela inicial. Mostra um resumão de como seus candidatos estão indo nas redes." },
  { title: "Resumo Inteligente", url: "/dashboard/candidate-summary", icon: FileText, tip: "A IA lê tudo que falaram do seu candidato e te entrega um resumo pronto." },
  { title: "Análise de Rejeição", url: "/dashboard/rejection-analysis", icon: ThumbsDown, tip: "Mostra por que as pessoas estão criticando seu candidato." },
  { title: "Recomendações de Narrativa", url: "/dashboard/narrative-recommendations", icon: Sparkles, tip: "Dicas de fala e postura para o seu candidato, com base no que o povo comenta." },
  { title: "Comparação de Candidatos", url: "/dashboard/candidate-comparison", icon: GitCompareArrows, tip: "Coloque dois ou mais candidatos lado a lado pra ver quem está melhor." },
  { title: "Picos de Menções", url: "/dashboard/pico-mencao", icon: Calendar, tip: "Descubra os picos de menções do seu candidato: debates, entrevistas, viralizações e momentos que impactaram nas redes." },
  { title: "Monitor Tempo Real", url: "/dashboard/realtime-monitor", icon: Radio, tip: "Acompanhe os comentários chegando ao vivo, na hora em que o povo posta." },
  { title: "Análise Regional", url: "/dashboard/regional-analysis", icon: MapPinned, tip: "Veja como seu candidato performa em cada região do Brasil por rede social." },
  { title: "Visão por Rede Social", url: "/dashboard/network-view", icon: Network, tip: "Filtre por rede (Instagram, X, YouTube, etc.) e veja KPIs, gráficos, top posts, hashtags e horários." },
  { title: "Eventos & Entrevistas", url: "/dashboard/political-events", icon: CalendarClock, tip: "Cadastre entrevistas, debates e comícios e meça o impacto nas redes (antes/durante/depois)." },
  
  { title: "Feeds Redes Sociais", url: "/dashboard/social-feeds", icon: Rss, tip: "Feeds com posts e menções de todas as redes sociais (LinkedIn, YouTube, Twitter, Reddit, Telegram, Notícias e mais)." },
  { title: "Candidatos", url: "/dashboard/candidates", icon: Users, tip: "Onde você adiciona, remove e cuida dos candidatos que está acompanhando." },
  { title: "Catálogo de Candidatos", url: "/dashboard/candidates-catalog", icon: BookUser, tip: "Lista de candidatos já prontos. Escolha um e adicione na sua conta com 1 clique." },
  { title: "Analytics Avançado", url: "/dashboard/analytics-advanced", icon: LineChart, tip: "Gráficos detalhados pra quem quer entender tudo a fundo." },
  { title: "Ranking", url: "/dashboard/ranking", icon: Trophy, tip: "Quem está ganhando e quem está perdendo nas redes nos últimos 30 dias." },
  { title: "Configuração de Coleta", url: "/dashboard/collection-status", icon: Database, tip: "Veja se a coleta de dados em cada rede social está funcionando direitinho." },
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
  { title: "Administração", url: "/dashboard/admin", icon: Shield, tip: "Área só pra administradores: cuidar de usuários, planos e da plataforma toda." },
  { title: "APIs & Integrações", url: "/dashboard/admin/api-settings", icon: Key, tip: "Liga e desliga as conexões com as redes sociais (YouTube, Twitter etc.)." },
  { title: "Observabilidade", url: "/dashboard/observability", icon: Shield, tip: "Saúde da plataforma, jobs em execução, fila de erros e ações de bulk processing." },
  { title: "Operations Console", url: "/dashboard/operations", icon: Shield, tip: "Filas distribuídas, workers ativos, providers IA e alertas em tempo real." },
  { title: "SLO & SLA", url: "/dashboard/slo", icon: Shield, tip: "Metas de serviço (latência, throughput, erro) e fila de jobs mortos (DLQ)." },
  { title: "Worker Tokens", url: "/dashboard/worker-tokens", icon: Key, tip: "Tokens para conectar workers externos (Docker/Railway) à fila distribuída." },
  { title: "Tenant Analytics", url: "/dashboard/tenant-analytics", icon: Shield, tip: "Consumo agregado por usuário: top tenants, custos e atividade." },
  { title: "Enriquecimento de Dados", url: "/dashboard/data-enrichment", icon: Database, tip: "Infere cidade/UF nas menções e roda backfill histórico via GDELT (notícias antigas)." },
];

const settingsItems = [
  { title: "Notificações", url: "/dashboard/notifications", icon: Bell, tip: "Avisos importantes: quando algo mudar, você fica sabendo aqui." },
  { title: "Configurações", url: "/dashboard/settings", icon: Settings, tip: "Mexa no seu perfil, troque a senha, mude o tema e ajuste suas preferências." },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const currentPath = location.pathname;
  const isCollapsed = state === "collapsed";
  const { isAdmin } = useAdminCheck();
  const tooltipsEnabled = useTooltipsEnabled();

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
                    <HelpTooltip text={item.tip} side="right">
                      <NavLink
                        to={item.url}
                        end={item.url === "/dashboard"}
                        className="flex items-center gap-3 hover:bg-muted/50 px-2 py-1.5 rounded-md"
                        activeClassName="bg-muted text-primary font-medium"
                      >
                        <div className="p-1.5 bg-muted/60 rounded-md">
                          <item.icon className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                        {!isCollapsed && <span className="font-medium">{item.title}</span>}
                      </NavLink>
                    </HelpTooltip>
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
                      <HelpTooltip text={item.tip} side="right">
                        <NavLink
                          to={item.url}
                          className="flex items-center gap-3 hover:bg-muted/50 px-2 py-1.5 rounded-md"
                          activeClassName="bg-muted text-primary font-medium"
                        >
                          <div className="p-1.5 bg-muted/60 rounded-md">
                            <item.icon className="h-4 w-4 shrink-0 text-primary" />
                          </div>
                          {!isCollapsed && <span className="font-medium">{item.title}</span>}
                        </NavLink>
                      </HelpTooltip>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Documentação — visível só para a conta demo de tooltips */}
        {tooltipsEnabled && (
          <SidebarGroup>
            <SidebarGroupLabel>Documentação</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <HelpTooltip
                      text="Entenda como cada rede social é monitorada: método, frequência e o que coletamos."
                      side="right"
                    >
                      <NavLink
                        to="/dashboard/data-collection-methodology"
                        className="flex items-center gap-3 hover:bg-muted/50 px-2 py-1.5 rounded-md"
                        activeClassName="bg-muted text-primary font-medium"
                      >
                        <div className="p-1.5 bg-muted/60 rounded-md">
                          <DatabaseIcon className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                        {!isCollapsed && <span className="font-medium">Como Coletamos os Dados</span>}
                      </NavLink>
                    </HelpTooltip>
                  </SidebarMenuButton>
                </SidebarMenuItem>
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
                    <HelpTooltip text={item.tip} side="right">
                      <NavLink
                        to={item.url}
                        className="flex items-center gap-3 hover:bg-muted/50 px-2 py-1.5 rounded-md"
                        activeClassName="bg-muted text-primary font-medium"
                      >
                        <div className="p-1.5 bg-muted/60 rounded-md">
                          <item.icon className="h-4 w-4 shrink-0 text-primary" />
                        </div>
                        {!isCollapsed && <span className="font-medium">{item.title}</span>}
                      </NavLink>
                    </HelpTooltip>
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
