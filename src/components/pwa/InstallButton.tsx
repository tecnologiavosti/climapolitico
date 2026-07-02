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
        "w-full h-8 text-xs gap-1.5 bg-white/10 hover:bg-white/20 text-white border border-white/20",
        className,
      )}
      title="Instalar aplicativo"
    >
      <Download className="h-3.5 w-3.5" />
      {!collapsed && <span>📲 Instalar App</span>}
    </Button>
  );
}
