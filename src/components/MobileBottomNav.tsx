import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  UserPlus,
  Users,
  Radio,
  Trophy,
  Menu,
  BarChart3,
  FileText,
  Heart,
  Sparkles,
  GitCompareArrows,
  Calendar,
  MapPinned,
  Rss,
  BookUser,
  LineChart,
  Database,
  Bell,
  Settings as SettingsIcon,
  LogOut,
  Shield,
  Key,
  MessagesSquare,
  Network,
  Brain,
  Flame,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { cn } from "@/lib/utils";

const bottomItems = [
  { label: "Visão Geral", icon: Home, to: "/dashboard", end: true },
  { label: "Candidatos", icon: Users, to: "/dashboard/candidates" },
  { label: "Tempo Real", icon: Radio, to: "/dashboard/realtime-monitor", badge: "live" as const },
  { label: "Resumo IA", icon: FileText, to: "/dashboard/candidate-summary", badge: "ai" as const },
];

type GridItem = { label: string; icon: any; to: string; badge?: "live" | "ai" };
type Section = { id: string; title: string; icon: any; items: GridItem[] };

const sections: Section[] = [
  {
    id: "inicio",
    title: "Início",
    icon: Home,
    items: [{ label: "Visão Geral", icon: BarChart3, to: "/dashboard" }],
  },
  {
    id: "config",
    title: "Configuração",
    icon: UserPlus,
    items: [
      { label: "Adicionar Candidato", icon: UserPlus, to: "/dashboard/candidates?add=1" },
      { label: "Catálogo de Candidatos", icon: BookUser, to: "/dashboard/candidates-catalog" },
      { label: "Meus Candidatos", icon: Users, to: "/dashboard/candidates" },
    ],
  },
  {
    id: "monitor",
    title: "Monitoramento",
    icon: Radio,
    items: [
      { label: "Monitor em Tempo Real", icon: Radio, to: "/dashboard/realtime-monitor", badge: "live" },
    ],
  },
  {
    id: "relatorios",
    title: "Relatórios",
    icon: FileText,
    items: [
      { label: "Resumo Inteligente", icon: FileText, to: "/dashboard/candidate-summary", badge: "ai" },
      { label: "Ranking", icon: Trophy, to: "/dashboard/ranking" },
      { label: "Por Rede Social", icon: Network, to: "/dashboard/network-view" },
      
    ],
  },
  {
    id: "analise",
    title: "Análise",
    icon: LineChart,
    items: [
      { label: "Sentimento", icon: Heart, to: "/dashboard/rejection-analysis" },
      { label: "Radar Político", icon: Calendar, to: "/dashboard/radar-politico" },
      { label: "Mapa de Aceitação", icon: MapPinned, to: "/dashboard/regional-analysis" },
      { label: "Comparação", icon: GitCompareArrows, to: "/dashboard/candidate-comparison" },
    ],
  },
  {
    id: "ia",
    title: "Inteligência IA",
    icon: Brain,
    items: [
      { label: "Narrativas", icon: Sparkles, to: "/dashboard/narrative-recommendations", badge: "ai" },
      { label: "Comparação Histórica", icon: GitCompareArrows, to: "/dashboard/historical-comparison", badge: "ai" },
    ],
  },
  {
    id: "conta",
    title: "Conta",
    icon: SettingsIcon,
    items: [
      { label: "Coleta", icon: Database, to: "/dashboard/collection-status" },
      { label: "Notificações", icon: Bell, to: "/dashboard/notifications" },
      { label: "Configurações", icon: SettingsIcon, to: "/dashboard/settings" },
    ],
  },
];

const adminSection: Section = {
  id: "admin",
  title: "Administração",
  icon: Shield,
  items: [
    { label: "Painel ADM", icon: Shield, to: "/dashboard/admin" },
    { label: "Usuários", icon: Users, to: "/dashboard/admin/users" },
    { label: "Financeiro", icon: BarChart3, to: "/dashboard/admin/finance" },
    { label: "Planos", icon: BookUser, to: "/dashboard/admin/plans" },
    { label: "Assinaturas", icon: BookUser, to: "/dashboard/admin/subscriptions" },
    { label: "Candidatos ADM", icon: Users, to: "/dashboard/admin/candidates" },
    { label: "Sistema", icon: SettingsIcon, to: "/dashboard/admin/system" },
    { label: "SEO", icon: LineChart, to: "/dashboard/admin/seo" },
    { label: "Analytics", icon: BarChart3, to: "/dashboard/admin/analytics" },
    { label: "Segurança", icon: Shield, to: "/dashboard/admin/security" },
    { label: "Logs", icon: FileText, to: "/dashboard/admin/logs" },
    { label: "Configurações ADM", icon: SettingsIcon, to: "/dashboard/admin/settings" },
    { label: "APIs & Integrações", icon: Key, to: "/dashboard/admin/api-settings" },
    { label: "Blog IA", icon: FileText, to: "/dashboard/admin/blog" },
    { label: "Observabilidade", icon: Shield, to: "/dashboard/observability" },
    { label: "Operations", icon: Shield, to: "/dashboard/operations" },
    { label: "SLO & SLA", icon: Shield, to: "/dashboard/slo" },
    { label: "Worker Tokens", icon: Key, to: "/dashboard/worker-tokens" },
    { label: "Tenant Analytics", icon: BarChart3, to: "/dashboard/tenant-analytics" },
    { label: "Diagnóstico", icon: Database, to: "/dashboard/data-diagnostics" },
    { label: "Saúde dos Coletores", icon: Shield, to: "/dashboard/collector-health" },
    { label: "Enriquecimento", icon: Database, to: "/dashboard/data-enrichment" },
  ],
};


function Badge({ variant }: { variant: "live" | "ai" }) {
  if (variant === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
        AO VIVO
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-gradient-primary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">
      IA
    </span>
  );
}

export function MobileBottomNav() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdmin } = useAdminCheck();

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const userInitial = (user?.email?.[0] || "A").toUpperCase();
  const userName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "Usuário";

  const allSections = isAdmin ? [...sections, adminSection] : sections;

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border shadow-lg"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Navegação inferior"
      >
        <ul className="grid grid-cols-5">
          {bottomItems.map((it) => {
            const Icon = it.icon;
            const active = it.end
              ? location.pathname === it.to
              : location.pathname.startsWith(it.to);
            return (
              <li key={it.to}>
                <NavLink
                  to={it.to}
                  end={it.end}
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 text-[10px] font-medium transition-colors min-h-[56px]",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "stroke-[2.5]")} />
                  <span className="leading-[1.1] text-center whitespace-normal break-words line-clamp-2 max-w-full px-0.5">
                    {it.label}
                  </span>
                  {it.badge === "live" && (
                    <span className="absolute top-1 right-3 h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  )}
                  {it.badge === "ai" && (
                    <span className="absolute top-1 right-3 h-1.5 w-1.5 rounded-full bg-primary" />
                  )}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="w-full h-full flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors min-h-[56px]"
              aria-label="Abrir menu completo"
            >
              <Menu className="h-4 w-4" />
              <span className="leading-[1.1]">Mais</span>
            </button>
          </li>
        </ul>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="md:hidden h-[88vh] rounded-t-3xl p-0 flex flex-col">
          <div className="pt-3 pb-1 flex justify-center shrink-0">
            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          </div>

          <div className="px-5 py-3 flex items-center gap-3 border-b shrink-0">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
              {userInitial}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-base truncate">{userName}</div>
              <div className="text-sm text-muted-foreground truncate">
                {isAdmin ? "Administrador" : "Usuário"}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-3">
            <Accordion
              type="multiple"
              defaultValue={["inicio", "config", "monitor", "analise"]}
              className="space-y-1"
            >
              {allSections.map((section) => {
                const SectionIcon = section.icon;
                return (
                  <AccordionItem
                    key={section.id}
                    value={section.id}
                    className="border-b-0 rounded-xl bg-muted/30 px-3"
                  >
                    <AccordionTrigger className="hover:no-underline py-3">
                      <div className="flex items-center gap-2.5">
                        <SectionIcon className="h-4 w-4 text-primary" />
                        <span className="text-sm font-bold uppercase tracking-wider">
                          {section.title}
                        </span>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="pb-3">
                      <div className={cn("grid gap-1.5", section.id === "admin" ? "grid-cols-2" : "grid-cols-1")}>
                        {section.items.map((it) => {
                          const Icon = it.icon;
                          return (
                            <button
                              key={it.label + it.to}
                              onClick={() => go(it.to)}
                              className="flex items-center gap-3 rounded-lg bg-background/60 hover:bg-background active:scale-[0.98] transition px-3 py-2.5 text-left"
                            >
                              <Icon className="h-4 w-4 shrink-0 text-primary" />
                              <span className="text-sm font-medium flex-1 min-w-0">
                                {it.label}
                              </span>
                              {it.badge && <Badge variant={it.badge} />}
                            </button>
                          );
                        })}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </div>

          <div
            className="border-t px-5 py-3 shrink-0"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <button
              onClick={() => {
                setOpen(false);
                signOut();
              }}
              className="flex items-center gap-3 text-destructive font-semibold py-2"
            >
              <LogOut className="h-5 w-5" />
              Sair
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
