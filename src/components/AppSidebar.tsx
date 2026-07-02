import { useEffect, useState } from "react";
import { NavLink } from "@/components/NavLink";
import { VipBadge } from "@/components/VipBadge";
import { InstallAppButton } from "@/components/pwa/InstallButton";
import { Link, useLocation } from "react-router-dom";
import logoAsset from "@/assets/clima-politico-logo.jpg.asset.json";
import {
  Home,
  UserPlus,
  Users,
  Radio,
  FileText,
  Flame,
  Heart,
  Calendar,
  MapPinned,
  GitCompareArrows,
  Sparkles,
  Brain,
  Bell,
  Trophy,
  LineChart,
  Network,
  Rss,
  MessagesSquare,
  Database,
  Settings,
  Shield,
  Key,
  BarChart3,
  BookUser,
  ChevronDown,
  Eye,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { useTooltipsEnabled } from "@/hooks/useTooltipsEnabled";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  badge?: { label: string; variant: "live" | "ai" };
  tip?: string;
};

type NavGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: NavItem[];
  defaultOpen?: boolean;
};

// Estrutura principal — fluxo lógico de uso da plataforma
const groups: NavGroup[] = [
  {
    id: "inicio",
    label: "Início",
    icon: Home,
    defaultOpen: true,
    items: [
      { title: "Visão Geral", url: "/dashboard", icon: Home, tip: "Tela inicial com o resumo da operação." },
    ],
  },
  {
    id: "config",
    label: "Configuração",
    icon: UserPlus,
    defaultOpen: true,
    items: [
      { title: "Adicionar Candidato", url: "/dashboard/candidates?add=1", icon: UserPlus, tip: "Abre o formulário de adicionar candidato." },
      { title: "Catálogo de Candidatos", url: "/dashboard/candidates-catalog", icon: BookUser, tip: "Candidatos prontos para adicionar." },
      { title: "Meus Candidatos", url: "/dashboard/candidates", icon: Users, tip: "Gerencie os candidatos que você está monitorando." },
    ],
  },
  {
    id: "monitor",
    label: "Monitoramento",
    icon: Radio,
    defaultOpen: true,
    items: [
      { title: "Monitor em Tempo Real", url: "/dashboard/realtime-monitor", icon: Radio, badge: { label: "AO VIVO", variant: "live" }, tip: "Comentários e menções chegando ao vivo." },
    ],
  },
  {
    id: "relatorios",
    label: "Relatórios",
    icon: FileText,
    defaultOpen: true,
    items: [
      { title: "Resumo Inteligente", url: "/dashboard/candidate-summary", icon: FileText, badge: { label: "IA", variant: "ai" }, tip: "Resumo automático do que falaram do seu candidato." },
      { title: "Ranking", url: "/dashboard/ranking", icon: Trophy, tip: "Ranking de desempenho dos candidatos." },
      { title: "Visão por Rede Social", url: "/dashboard/network-view", icon: Network, tip: "Resultados detalhados por rede social." },
    ],
  },
  {
    id: "analise",
    label: "Análise",
    icon: LineChart,
    defaultOpen: true,
    items: [
      { title: "Análise de Sentimento", url: "/dashboard/rejection-analysis", icon: Heart, tip: "Entenda o tom da conversa: positivo, neutro ou negativo." },
      { title: "Radar Político", url: "/dashboard/radar-politico", icon: Calendar, tip: "Eventos políticos reais detectados externamente." },
      { title: "Mapa de Aceitação", url: "/dashboard/regional-analysis", icon: MapPinned, tip: "Performance por região do Brasil." },
      { title: "Comparação de Candidatos", url: "/dashboard/candidate-comparison", icon: GitCompareArrows, tip: "Compare candidatos lado a lado." },
    ],
  },
  {
    id: "ia",
    label: "Inteligência IA",
    icon: Brain,
    defaultOpen: false,
    items: [
      { title: "Narrativas Detectadas", url: "/dashboard/narrative-recommendations", icon: Sparkles, badge: { label: "IA", variant: "ai" }, tip: "Narrativas em ascensão e recomendações." },
      { title: "Comparação Histórica", url: "/dashboard/historical-comparison", icon: GitCompareArrows, badge: { label: "IA", variant: "ai" }, tip: "Compare dois períodos do candidato com análise por IA." },
    ],
  },
];

const accountGroup: NavGroup = {
  id: "conta",
  label: "Conta",
  icon: Settings,
  defaultOpen: false,
  items: [
    { title: "Configuração de Coleta", url: "/dashboard/collection-status", icon: Database, tip: "Status da coleta em cada rede." },
    { title: "Notificações", url: "/dashboard/notifications", icon: Bell, tip: "Central de avisos da plataforma." },
    { title: "Configurações", url: "/dashboard/settings", icon: Settings, tip: "Perfil, senha, tema e preferências." },
  ],
};

const adminGroup: NavGroup = {
  id: "admin",
  label: "ADMIN",
  icon: Shield,
  defaultOpen: false,
  items: [
    { title: "Painel Administrativo", url: "/dashboard/admin", icon: Shield, tip: "Acessa o painel dedicado do administrador." },
  ],
};


function BadgePill({ label, variant }: { label: string; variant: "live" | "ai" }) {
  if (variant === "live") {
    return (
      <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
        {label}
      </span>
    );
  }
  return (
    <span className="ml-auto inline-flex items-center rounded-full bg-gradient-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
      {label}
    </span>
  );
}

function useHasCandidates() {
  const { user } = useAuth();
  const [hasCandidates, setHasCandidates] = useState<boolean | null>(null);
  useEffect(() => {
    if (!user) {
      setHasCandidates(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("candidates")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id);
      if (!cancelled) setHasCandidates((count ?? 0) > 0);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);
  return hasCandidates;
}

function OnboardingBanner() {
  const hasCandidates = useHasCandidates();
  if (hasCandidates !== false) return null;
  return (
    <div className="mx-3 mt-3 mb-1 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-primary/5 p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <div className="rounded-lg bg-primary/15 p-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
            Passo 1
          </div>
          <p className="text-xs text-foreground/80 mt-0.5 leading-snug">
            Adicione um candidato para começar.
          </p>
        </div>
      </div>
      <Button asChild size="sm" className="w-full mt-2 h-8 text-xs">
        <Link to="/dashboard/candidates?add=1">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
          Adicionar candidato
        </Link>
      </Button>
    </div>
  );
}

function NavRow({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  return (
    <NavLink
      to={item.url}
      end={item.url === "/dashboard"}
      className="group flex items-center gap-3 hover:bg-muted/60 px-2 py-1.5 rounded-md"
      activeClassName="bg-muted text-primary font-semibold"
      title={collapsed ? item.title : undefined}
    >
      <div className="p-1.5 bg-muted/60 rounded-md group-hover:bg-muted">
        <item.icon className="h-4 w-4 shrink-0 text-primary" />
      </div>
      {!collapsed && (
        <>
          <span className="font-medium text-sm leading-snug whitespace-normal break-words flex-1 min-w-0">
            {item.title}
          </span>
          {item.badge && <BadgePill label={item.badge.label} variant={item.badge.variant} />}
        </>
      )}
    </NavLink>
  );
}

function GroupBlock({ group, collapsed, currentPath }: { group: NavGroup; collapsed: boolean; currentPath: string }) {
  const isActiveGroup = group.items.some((it) =>
    it.url === "/dashboard" ? currentPath === it.url : currentPath.startsWith(it.url),
  );
  const [open, setOpen] = useState(group.defaultOpen || isActiveGroup);

  useEffect(() => {
    if (isActiveGroup) setOpen(true);
  }, [isActiveGroup]);

  // When the sidebar is collapsed to icons, render items flat
  if (collapsed) {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {group.items.map((item) => (
              <SidebarMenuItem key={item.title + item.url}>
                <SidebarMenuButton asChild>
                  <NavRow item={item} collapsed />
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const GroupIcon = group.icon;

  return (
    <SidebarGroup className="py-1">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors",
            )}
          >
            <GroupIcon className="h-3.5 w-3.5" />
            <span className="flex-1 text-left">{group.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarGroupContent className="border-l border-border/60 ml-4 pl-1 mt-1">
            <SidebarMenu>
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title + item.url}>
                  <SidebarMenuButton asChild>
                    <NavRow item={item} collapsed={false} />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </CollapsibleContent>
      </Collapsible>
    </SidebarGroup>
  );
}

export function AppSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const isCollapsed = state === "collapsed";
  const { isAdmin } = useAdminCheck();
  const tooltipsEnabled = useTooltipsEnabled();

  return (
    <Sidebar
      className={isCollapsed ? "w-14" : "w-[17rem]"}
      style={{ background: "var(--gradient-sidebar)" }}
    >
      <SidebarContent className="text-white">
        {/* Logo */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2.5">
            <img
              src={logoAsset.url}
              alt="Clima Político"
              className="h-9 w-9 rounded-full object-cover ring-2 ring-white/30 shadow-md shrink-0"
            />
            {!isCollapsed && (
              <span className="font-bold text-base text-white tracking-tight">
                Clima Político
              </span>
            )}
          </div>
        </div>


        {!isCollapsed && <OnboardingBanner />}

        {groups.map((group) => (
          <GroupBlock
            key={group.id}
            group={group}
            collapsed={isCollapsed}
            currentPath={location.pathname}
          />
        ))}

        {isAdmin && (
          <GroupBlock group={adminGroup} collapsed={isCollapsed} currentPath={location.pathname} />
        )}

        {tooltipsEnabled && (
          <GroupBlock
            group={{
              id: "docs",
              label: "Documentação",
              icon: Eye,
              items: [
                { title: "Como Coletamos os Dados", url: "/dashboard/data-collection-methodology", icon: Database },
              ],
            }}
            collapsed={isCollapsed}
            currentPath={location.pathname}
          />
        )}

        <div className="px-3 pt-2">
          <InstallAppButton collapsed={isCollapsed} />
        </div>
        <VipBadge collapsed={isCollapsed} />
        <GroupBlock group={accountGroup} collapsed={isCollapsed} currentPath={location.pathname} />
      </SidebarContent>
    </Sidebar>
  );
}
