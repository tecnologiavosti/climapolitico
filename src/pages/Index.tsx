import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroSection } from "@/components/landing/HeroSection";
import { SocialProof } from "@/components/landing/SocialProof";
import { BentoFeatures } from "@/components/landing/BentoFeatures";
import { useNavigate } from "react-router-dom";

const Index = () => {
  const navigate = useNavigate();
  
  return (
    <div className="min-h-screen bg-gradient-secondary">
      {/* Hero Section */}
      <HeroSection />

      {/* Social Proof Stats */}
      <SocialProof />

      {/* Features Section */}
      <BentoFeatures />

      {/* Pricing Section */}
      <section className="container mx-auto px-4 py-20">
        <div className="text-center mb-12 animate-fade-in-up">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Planos <span className="gradient-text">Flexíveis</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            Escolha o plano ideal para suas necessidades
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Basic Plan */}
          <Card className="p-8 hover-lift hover-glow transition-all duration-300 border-2 animate-fade-in-up" style={{ animationDelay: "0ms" }}>
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-bold mb-2">Básico</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">R$ 299</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Até 3 candidatos
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  3 atualizações/mês
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Dashboard padrão
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Export CSV
                </li>
              </ul>
              <Button className="w-full" variant="outline" onClick={() => navigate('/auth')}>
                Começar
              </Button>
            </div>
          </Card>

          {/* Pro Plan */}
          <Card className="p-8 hover-lift hover-glow transition-all duration-300 border-2 border-primary relative animate-fade-in-up" style={{ animationDelay: "100ms" }}>
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-primary animate-glow-pulse">
              Mais Popular
            </Badge>
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-bold mb-2">Pro</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">R$ 899</span>
                  <span className="text-muted-foreground">/mês</span>
                </div>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Até 10 candidatos
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  10 atualizações/mês
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Relatórios em PDF
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Alertas por email/SMS
                </li>
              </ul>
              <Button className="w-full bg-gradient-primary hover-glow" onClick={() => navigate('/auth')}>
                Começar
              </Button>
            </div>
          </Card>

          {/* Enterprise Plan */}
          <Card className="p-8 hover-lift hover-glow transition-all duration-300 border-2 animate-fade-in-up" style={{ animationDelay: "200ms" }}>
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold">Custom</span>
                </div>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Candidatos ilimitados
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Atualizações em tempo real
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  API privada
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Múltiplos usuários
                </li>
              </ul>
              <Button className="w-full" variant="outline" onClick={() => navigate('/auth')}>
                Falar com Vendas
              </Button>
            </div>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <Card className="p-12 md:p-16 bg-gradient-hero text-white text-center relative overflow-hidden animate-fade-in-up">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
          <div className="relative z-10 space-y-6">
            <h2 className="text-3xl md:text-5xl font-bold mb-4">
              Pronto para transformar sua estratégia política?
            </h2>
            <p className="text-xl md:text-2xl mb-8 opacity-90 max-w-2xl mx-auto">
              Comece hoje e tenha acesso a insights que fazem a diferença
            </p>
            <Button 
              size="lg" 
              variant="secondary" 
              className="hover-scale text-base h-12 px-8"
              onClick={() => navigate('/auth')}
            >
              Iniciar Teste Gratuito
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
};

export default Index;
