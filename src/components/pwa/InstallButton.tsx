import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "./InstallPrompt";
import { cn } from "@/lib/utils";

export function InstallAppButton({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const { canInstall, promptInstall } = usePwaInstall();
  if (!canInstall) return null;
  return (
    <Button
      onClick={() => void promptInstall()}
      size="sm"
      className={cn(
        "w-full h-9 text-xs gap-1.5 bg-white/10 text-white border border-white/20",
        "transition-all duration-300 hover:bg-[#0ea5e9]/20 hover:border-[#0ea5e9]/60",
        "hover:shadow-[0_0_20px_rgba(14,165,233,0.45)] animate-fade-in",
        className,
      )}
      title="Instale o Clima Político no seu dispositivo"
    >
      <Download className="h-3.5 w-3.5 animate-bounce-subtle" />
      {!collapsed && <span>📲 Instalar App</span>}
    </Button>
  );
}
