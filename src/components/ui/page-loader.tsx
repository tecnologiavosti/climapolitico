import { Loader2 } from "lucide-react";

export const PageLoader = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-secondary">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    </div>
  );
};
