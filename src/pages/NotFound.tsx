import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useEffect } from "react";
import { Home, Search, AlertCircle } from "lucide-react";

const NotFound = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-secondary">
      <div className="text-center space-y-8 p-8 max-w-2xl mx-auto animate-fade-in-up">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-primary opacity-20 blur-3xl rounded-full" />
          <h1 className="text-9xl font-bold gradient-text relative z-10">
            404
          </h1>
        </div>
        
        <div className="space-y-4">
          <div className="inline-block p-4 bg-muted rounded-full">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
          </div>
          <h2 className="text-3xl font-semibold text-foreground">
            Página não encontrada
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed max-w-md mx-auto">
            A página que você está procurando não existe ou foi removida. Que tal voltar para o início?
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4">
          <Button 
            onClick={() => navigate(-1)} 
            variant="outline"
            className="hover-lift"
          >
            <Search className="mr-2 h-4 w-4" />
            Voltar
          </Button>
          <Button 
            onClick={() => navigate("/")}
            className="bg-gradient-primary hover-glow"
          >
            <Home className="mr-2 h-4 w-4" />
            Ir para Início
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
