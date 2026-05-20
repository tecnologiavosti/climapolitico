import { NavLink, useLocation } from "react-router-dom";
import { Home, Users, Radio, Trophy, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const items = [
  { label: "Início", icon: Home, to: "/dashboard", end: true },
  { label: "Candidatos", icon: Users, to: "/dashboard/candidates" },
  { label: "Tempo Real", icon: Radio, to: "/dashboard/realtime-monitor" },
  { label: "Ranking", icon: Trophy, to: "/dashboard/ranking" },
];

export function MobileBottomNav() {
  const { setOpenMobile } = useSidebar();
  const location = useLocation();

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur border-t border-border shadow-lg"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Navegação inferior"
    >
      <ul className="grid grid-cols-5">
        {items.map((it) => {
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
                  "flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                <span className="truncate max-w-full">{it.label}</span>
              </NavLink>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="w-full h-full flex flex-col items-center justify-center gap-0.5 py-2 px-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Abrir menu completo"
          >
            <Menu className="h-5 w-5" />
            <span>Mais</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
