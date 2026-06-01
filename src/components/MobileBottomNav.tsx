import { useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Users,
  Radio,
  Trophy,
  Menu,
  X,
  BarChart3,
  FileText,
  ThumbsDown,
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
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { cn } from "@/lib/utils";

const bottomItems = [
  { label: "Visão Geral", icon: Home, to: "/dashboard", end: true },
  { label: "Candidatos", icon: Users, to: "/dashboard/candidates" },
  { label: "Monitor Tempo Real", icon: Radio, to: "/dashboard/realtime-monitor" },
  { label: "Ranking", icon: Trophy, to: "/dashboard/ranking" },
];

type GridItem = { label: string; icon: any; to: string };

const mainGrid: GridItem[] = [
  { label: "Visão Geral", icon: BarChart3, to: "/dashboard" },
  { label: "Resumo IA", icon: FileText, to: "/dashboard/candidate-summary" },
  { label: "Rejeição", icon: ThumbsDown, to: "/dashboard/rejection-analysis" },
  { label: "Narrativa", icon: Sparkles, to: "/dashboard/narrative-recommendations" },
  { label: "Comparação", icon: GitCompareArrows, to: "/dashboard/candidate-comparison" },
  { label: "Picos", icon: Calendar, to: "/dashboard/pico-mencao" },
  { label: "Tempo Real", icon: Radio, to: "/dashboard/realtime-monitor" },
  { label: "Repercussão", icon: MessagesSquare, to: "/dashboard/event-repercussion" },
  { label: "Regional", icon: MapPinned, to: "/dashboard/regional-analysis" },
  { label: "Redes Sociais", icon: Network, to: "/dashboard/network-view" },
  { label: "Histórica IA", icon: GitCompareArrows, to: "/dashboard/historical-comparison" },
  { label: "Feeds", icon: Rss, to: "/dashboard/social-feeds" },
  { label: "Candidatos", icon: Users, to: "/dashboard/candidates" },
  { label: "Catálogo", icon: BookUser, to: "/dashboard/candidates-catalog" },
  { label: "Analytics", icon: LineChart, to: "/dashboard/analytics-advanced" },
  { label: "Ranking", icon: Trophy, to: "/dashboard/ranking" },
  { label: "Coleta", icon: Database, to: "/dashboard/collection-status" },
];

const adminGrid: GridItem[] = [
  { label: "Admin", icon: Shield, to: "/dashboard/admin" },
  { label: "APIs", icon: Key, to: "/dashboard/admin/api-settings" },
  { label: "Observabilidade", icon: Shield, to: "/dashboard/observability" },
  { label: "Operations", icon: Shield, to: "/dashboard/operations" },
  { label: "SLO & SLA", icon: Shield, to: "/dashboard/slo" },
  { label: "Tokens", icon: Key, to: "/dashboard/worker-tokens" },
  { label: "Tenants", icon: Shield, to: "/dashboard/tenant-analytics" },
];

const settingsGrid: GridItem[] = [
  { label: "Notificações", icon: Bell, to: "/dashboard/notifications" },
  { label: "Configurações", icon: SettingsIcon, to: "/dashboard/settings" },
];

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

  const Section = ({ title, items }: { title: string; items: GridItem[] }) => (
    <div className="mb-2">
      <h3 className="px-1 mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="grid grid-cols-4 gap-2">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.label + it.to}
              onClick={() => go(it.to)}
              className="flex flex-col items-center gap-1.5 rounded-2xl bg-muted/40 hover:bg-muted active:scale-95 transition p-3 min-h-[88px]"
            >
              <Icon className="h-6 w-6 text-foreground" strokeWidth={1.8} />
              <span className="text-[11px] leading-tight text-center text-foreground line-clamp-2">
                {it.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

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
                    "flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 text-[10px] font-medium transition-colors min-h-[56px]",
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-4 w-4 shrink-0", active && "stroke-[2.5]")} />
                  <span className="leading-[1.1] text-center whitespace-normal break-words line-clamp-2 max-w-full px-0.5">{it.label}</span>
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
        <SheetContent
          side="bottom"
          className="md:hidden h-[88vh] rounded-t-3xl p-0 flex flex-col"
        >
          {/* Drag handle */}
          <div className="pt-3 pb-1 flex justify-center shrink-0">
            <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
          </div>

          {/* Profile header */}
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

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <Section title="Principal" items={mainGrid} />
            {isAdmin && <Section title="Administração" items={adminGrid} />}
            <Section title="Configurações" items={settingsGrid} />
          </div>

          {/* Logout */}
          <div className="border-t px-5 py-3 shrink-0" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
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
