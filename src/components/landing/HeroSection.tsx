import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, BarChart3, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import logoAsset from "@/assets/clima-politico-logo.png.asset.json";

export const HeroSection = () => {
  const navigate = useNavigate();

  return (
    <section
      className="relative overflow-hidden py-20 md:py-32 text-white"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,rgba(30,181,232,0.25),transparent_55%)]" />

      <div className="container mx-auto px-4 relative z-10">
        <div className="max-w-4xl mx-auto text-center space-y-8 animate-fade-in-up">
          <div className="flex justify-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-3xl bg-white/30" aria-hidden />
              <img
                src={logoAsset.url}
                alt="Clima Político"
                className="relative h-28 w-28 md:h-32 md:w-32 rounded-full object-cover ring-4 ring-white/40 shadow-2xl"
              />
            </div>
          </div>

          <Badge variant="secondary" className="mb-2 hover-scale bg-white/15 text-white border-white/20 backdrop-blur">
            <Sparkles className="mr-1 h-3 w-3" />
            Powered by AI Analytics
          </Badge>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold leading-tight">
            <span className="text-white drop-shadow">Clima Político</span>
            <br />
            <span className="text-white/80">Analytics</span>
          </h1>

          <p className="text-lg md:text-xl text-white/85 max-w-2xl mx-auto leading-relaxed">
            Inteligência Artificial para análise política em tempo real.
            Monitore, analise e compreenda o cenário político nas redes sociais.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center pt-4">
            <Button
              size="lg"
              className="bg-white text-primary hover:bg-white/90 hover:-translate-y-0.5 transition-all duration-300 text-base h-12 px-8 shadow-xl"
              onClick={() => navigate('/auth')}
            >
              Começar Análise
              <TrendingUp className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="bg-transparent text-white border-white/40 hover:bg-white/10 hover:text-white transition-all duration-300 text-base h-12 px-8"
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
