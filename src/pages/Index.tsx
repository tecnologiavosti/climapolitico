import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Users, Shield, LineChart, Globe, Zap, Lock } from "lucide-react";
import { StatsGrid } from "@/components/dashboard/StatsGrid";
import { FeatureCard } from "@/components/features/FeatureCard";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-secondary">
      {/* Hero Section */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-hero opacity-10" />
        <div className="container mx-auto px-4 py-20 relative z-10">
          <div className="max-w-4xl mx-auto text-center space-y-8">
            <Badge variant="secondary" className="mb-4">
              Powered by AI Analytics
            </Badge>
            <h1 className="text-5xl md:text-7xl font-bold bg-gradient-primary bg-clip-text text-transparent leading-tight">
              Clima Político Analytics
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
              Inteligência Artificial para análise política em tempo real. 
              Monitore, analise e compreenda o cenário político nas redes sociais.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Button size="lg" className="bg-gradient-primary hover:shadow-glow transition-all duration-300">
                Começar Análise
                <TrendingUp className="ml-2 h-5 w-5" />
              </Button>
              <Button size="lg" variant="outline">
                Ver Demo
                <BarChart3 className="ml-2 h-5 w-5" />
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Preview */}
      <section className="container mx-auto px-4 py-16">
        <StatsGrid />
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Recursos Poderosos de Análise
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Tecnologia de ponta para transformar dados em insights estratégicos
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <FeatureCard
            icon={<Users className="h-8 w-8" />}
            title="Análise de Audiência"
            description="Identifique seguidores reais vs. fake com IA avançada de detecção de padrões"
          />
          <FeatureCard
            icon={<LineChart className="h-8 w-8" />}
            title="Sentimento em Tempo Real"
            description="Análise de sentimento político e tendências ideológicas por região e demografia"
          />
          <FeatureCard
            icon={<Globe className="h-8 w-8" />}
            title="Multi-Plataforma"
            description="Integração com Twitter, Instagram, Facebook, TikTok, LinkedIn e mais"
          />
          <FeatureCard
            icon={<Shield className="h-8 w-8" />}
            title="Segurança LGPD"
            description="Conformidade total com LGPD e GDPR para proteção de dados"
          />
          <FeatureCard
            icon={<Zap className="h-8 w-8" />}
            title="Alertas Inteligentes"
            description="Notificações automáticas para picos de menções e crises de imagem"
          />
          <FeatureCard
            icon={<Lock className="h-8 w-8" />}
            title="Dashboard Admin"
            description="Gestão completa de usuários, assinaturas e relatórios customizados"
          />
        </div>
      </section>

      {/* Pricing Preview */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Planos Flexíveis
          </h2>
          <p className="text-muted-foreground text-lg">
            Escolha o plano ideal para suas necessidades
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Basic Plan */}
          <Card className="p-8 hover:shadow-lg transition-all duration-300 border-2">
            <div className="space-y-4">
              <h3 className="text-2xl font-bold">Básico</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">R$ 299</span>
                <span className="text-muted-foreground">/mês</span>
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
              <Button className="w-full" variant="outline">
                Começar
              </Button>
            </div>
          </Card>

          {/* Pro Plan */}
          <Card className="p-8 hover:shadow-glow transition-all duration-300 border-2 border-primary relative">
            <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-primary">
              Mais Popular
            </Badge>
            <div className="space-y-4">
              <h3 className="text-2xl font-bold">Pro</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">R$ 899</span>
                <span className="text-muted-foreground">/mês</span>
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
              <Button className="w-full bg-gradient-primary">
                Começar
              </Button>
            </div>
          </Card>

          {/* Enterprise Plan */}
          <Card className="p-8 hover:shadow-lg transition-all duration-300 border-2">
            <div className="space-y-4">
              <h3 className="text-2xl font-bold">Enterprise</h3>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-bold">Custom</span>
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
              <Button className="w-full" variant="outline">
                Falar com Vendas
              </Button>
            </div>
          </Card>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-20">
        <Card className="p-12 bg-gradient-hero text-white text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Pronto para transformar sua estratégia política?
          </h2>
          <p className="text-xl mb-8 opacity-90">
            Comece hoje e tenha acesso a insights que fazem a diferença
          </p>
          <Button size="lg" variant="secondary">
            Iniciar Teste Gratuito
          </Button>
        </Card>
      </section>
    </div>
  );
};

export default Index;
