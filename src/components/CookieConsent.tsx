import { useEffect, useState } from "react";
import { Cookie, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "cookies_accepted";

export function CookieConsent() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) setOpen(true);
  }, []);

  if (!open) return null;

  const accept = () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  };
  const decline = () => {
    window.localStorage.setItem(STORAGE_KEY, "false");
    setOpen(false);
  };
  const dismiss = () => setOpen(false);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-title"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-primary/30 bg-card text-card-foreground shadow-2xl">
        <div className="absolute -top-5 -left-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Cookie className="h-6 w-6" />
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Fechar"
          className="absolute top-3 right-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6 pt-8 space-y-4">
          <h2 id="cookie-title" className="text-lg font-semibold">
            Sua privacidade é prioridade
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Usamos cookies para autenticação, segurança e melhorar sua experiência. Leia nossa{" "}
            <a
              href="/politica-de-privacidade"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Política de Cookies
            </a>{" "}
            e{" "}
            <a
              href="/politica-de-privacidade"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Política de Privacidade
            </a>
            .
          </p>

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={decline}>
              Recusar
            </Button>
            <Button className="flex-1" onClick={accept}>
              Aceitar todos
            </Button>
          </div>

          <a
            href="/politica-de-privacidade"
            className="block text-center text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline"
          >
            Configurar preferências
          </a>
        </div>
      </div>
    </div>
  );
}
