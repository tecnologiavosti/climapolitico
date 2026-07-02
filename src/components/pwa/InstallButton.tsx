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
import { usePwaInstall, isMobileDevice, isIOSSafari } from "./InstallPrompt";
import { cn } from "@/lib/utils";

export function InstallAppButton({
  collapsed = false,
  className,
}: {
  collapsed?: boolean;
  className?: string;
}) {
  const { canInstall, installed, promptInstall } = usePwaInstall();
  const [showHelp, setShowHelp] = useState(false);

  // Mobile-only. Desktop nunca renderiza nada relacionado a PWA.
  if (!isMobileDevice()) return null;
  if (installed) return null;

  const iosSafari = isIOSSafari();

  // Se não é iOS Safari e não há prompt nativo (ex: Android sem trigger ainda),
  // não mostrar botão — evita CTA sem ação.
  if (!canInstall && !iosSafari) return null;

  const handleClick = async () => {
    if (canInstall) {
      const ok = await promptInstall();
      if (!ok) setShowHelp(true);
    } else {
      setShowHelp(true);
    }
  };

  return (
    <>
      <Button
        onClick={handleClick}
        size="sm"
        className={cn(
          "w-full h-9 text-xs gap-1.5",
          "bg-primary/10 text-primary border border-primary/20",
          "dark:bg-cyan-400/15 dark:text-slate-50 dark:border-cyan-400/30",
          "transition-all duration-300 hover:bg-primary/20",
          "hover:shadow-[0_0_20px_hsl(var(--primary)/0.35)]",
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
              Adicione o app à tela inicial do seu dispositivo:
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-3">
            {iosSafari ? (
              <ol className="list-decimal pl-5 space-y-1">
                <li>Toque no ícone <strong>Compartilhar</strong> (□↑) na barra do Safari.</li>
                <li>Escolha <strong>"Adicionar à Tela de Início"</strong>.</li>
                <li>Confirme tocando em <strong>Adicionar</strong>.</li>
              </ol>
            ) : (
              <ol className="list-decimal pl-5 space-y-1">
                <li>Toque no menu <strong>⋮</strong> do Chrome.</li>
                <li>Selecione <strong>"Instalar aplicativo"</strong> ou <strong>"Adicionar à tela inicial"</strong>.</li>
              </ol>
            )}
            <p className="text-muted-foreground text-xs">
              A instalação só está disponível em dispositivos móveis (Android/iOS) no app publicado via HTTPS.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
