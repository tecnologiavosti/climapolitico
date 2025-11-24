import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, BarChart3, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section className="relative overflow-hidden py-20 md:py-32">
      {/* Background Effects */}
      <div className="absolute inset-0 bg-gradient-hero opacity-10 animate-float" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.1),transparent_50%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_80%,hsl(var(--accent)/0.1),transparent_50%)]" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in-up">
          <Badge variant="secondary" className="mb-4 hover-scale">
            <Sparkles className="mr-1 h-3 w-3" />
            Powered by AI Analytics
          </Badge>
          
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-tight">
            <span className="gradient-text">Clima Político</span>
            <br />
            <span className="text-foreground">Analytics</span>
          </h1>
          
          <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Inteligência Artificial para análise política em tempo real. 
            Monitore, analise e compreenda o cenário político nas redes sociais.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button 
              size="lg" 
              className="bg-gradient-primary hover-glow hover:scale-105 transition-all duration-300 text-base h-12 px-8"
              onClick={() => navigate('/auth')}
            >
              Começar Análise
              <TrendingUp className="ml-2 h-5 w-5" />
            </Button>
            <Button 
              size="lg" 
              variant="outline"
              className="hover:bg-muted transition-all duration-300 text-base h-12 px-8"
              onClick={() => navigate('/auth')}
            >
              Entrar
              <BarChart3 className="ml-2 h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};
