import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall } from "./InstallPrompt";
import { cn } from "@/lib/utils";

function detectPlatform(): "ios" | "android" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "desktop";
}

export function InstallAppButton({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const { canInstall, installed, promptInstall } = usePwaInstall();
  const [showHelp, setShowHelp] = useState(false);

  // Se já estiver instalado, esconder totalmente
  if (installed) return null;

  const handleClick = async () => {
    if (canInstall) {
      const ok = await promptInstall();
      if (!ok) setShowHelp(true);
    } else {
      setShowHelp(true);
    }
  };

  const platform = detectPlatform();

  return (
    <>
      <Button
        onClick={handleClick}
        size="sm"
        className={cn(
          "w-full h-9 text-xs gap-1.5 bg-white/10 text-white border border-white/20",
          "transition-all duration-300 hover:bg-[#0ea5e9]/20 hover:border-[#0ea5e9]/60",
          "hover:shadow-[0_0_20px_rgba(14,165,233,0.45)]",
          className,
        )}
        title="Instale o Clima Político no seu dispositivo"
      >
        <Download className="h-3.5 w-3.5" />
        {!collapsed && <span>📲 Instalar App</span>}
      </Button>

      <Dialog open={showHelp} onOpenChange={setShowHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Instalar Clima Político</DialogTitle>
            <DialogDescription>
              Para instalar como aplicativo no seu dispositivo:
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-3">
            {platform === "ios" && (
              <p>
                No <strong>Safari</strong>: toque no ícone <strong>Compartilhar</strong> (□↑) e
                selecione <strong>"Adicionar à Tela de Início"</strong>.
              </p>
            )}
            {platform === "android" && (
              <p>
                No <strong>Chrome</strong>: toque no menu <strong>⋮</strong> no canto superior
                direito e selecione <strong>"Instalar aplicativo"</strong> ou{" "}
                <strong>"Adicionar à tela inicial"</strong>.
              </p>
            )}
            {platform === "desktop" && (
              <p>
                No <strong>Chrome/Edge</strong>: clique no ícone de instalação (⊕) na barra de
                endereço, ou vá em <strong>Menu → Instalar Clima Político</strong>.
              </p>
            )}
            <p className="text-muted-foreground text-xs">
              A instalação nativa só está disponível no app publicado (HTTPS) e depende do
              navegador reconhecer os requisitos do PWA.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
