import { useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePwaInstall, isMobileDevice, isIOSSafari } from "./InstallPrompt";

export function InstallPwaBanner() {
  const { canInstall, installed, promptInstall } = usePwaInstall();
  const [showIOSHelp, setShowIOSHelp] = useState(false);

  // Mobile-only
  if (!isMobileDevice()) return null;
  if (installed) return null;

  const iosSafari = isIOSSafari();

  // Só renderiza se instalável (Android com prompt) ou iOS Safari (via instrução manual)
  if (!canInstall && !iosSafari) return null;

  const handleClick = async () => {
    if (canInstall) {
      const ok = await promptInstall();
      if (!ok && iosSafari) setShowIOSHelp(true);
    } else {
      setShowIOSHelp(true);
    }
  };

  return (
    <>
      <div className="container mx-auto px-4 pt-4 animate-fade-in-up">
        <div
          className="
            relative overflow-hidden rounded-3xl p-5 sm:p-6
            flex items-center gap-4
            border
            bg-primary/[0.08] border-primary/15
            dark:bg-slate-900/80 dark:border-cyan-400/15
            [background:linear-gradient(135deg,hsl(var(--primary)/0.10),hsl(var(--accent)/0.06))]
            shadow-sm
          "
        >
          <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/60 shadow-md shadow-primary/25">
            <Smartphone className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm sm:text-base font-bold leading-tight">
              📲 Instale o Clima Político
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 leading-snug">
              Acesso rápido, notificações e experiência premium no seu celular.
            </p>
          </div>
          <Button
            onClick={handleClick}
            size="sm"
            className="
              shrink-0 h-9 px-3 text-xs sm:text-sm gap-1.5
              bg-primary/90 hover:bg-primary text-primary-foreground
              transition-transform duration-200 hover:scale-[1.02]
              hover:shadow-[0_0_20px_hsl(var(--primary)/0.35)]
            "
          >
            <Download className="h-4 w-4" />
            <span className="hidden xs:inline">Instalar</span>
            <span className="xs:hidden">Instalar</span>
          </Button>
        </div>
      </div>

      <Dialog open={showIOSHelp} onOpenChange={setShowIOSHelp}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar à Tela de Início</DialogTitle>
            <DialogDescription>
              No seu iPhone/iPad, para instalar o Clima Político:
            </DialogDescription>
          </DialogHeader>
          <ol className="list-decimal pl-5 text-sm space-y-1">
            <li>Toque no ícone <strong>Compartilhar</strong> (□↑) na barra do Safari.</li>
            <li>Escolha <strong>"Adicionar à Tela de Início"</strong>.</li>
            <li>Confirme tocando em <strong>Adicionar</strong>.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
