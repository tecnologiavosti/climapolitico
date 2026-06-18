import { ReactNode, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { PageLoader } from "@/components/ui/page-loader";
import { toast } from "@/hooks/use-toast";

export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin, isLoading } = useAdminCheck();

  useEffect(() => {
    if (!isLoading && !isAdmin) {
      toast({
        title: "Acesso negado",
        description: "Você não tem permissão para acessar essa área.",
        variant: "destructive",
      });
    }
  }, [isAdmin, isLoading]);

  if (isLoading) return <PageLoader />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
