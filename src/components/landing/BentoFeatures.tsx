import { Card } from "@/components/ui/card";
import { Users, LineChart, Globe, Shield, Zap, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Users,
    title: "Análise de Audiência",
    description: "Identifique seguidores reais vs. fake com IA avançada de detecção de padrões",
    className: "md:col-span-2 lg:col-span-1",
  },
  {
    icon: LineChart,
    title: "Sentimento em Tempo Real",
    description: "Análise de sentimento político e tendências ideológicas por região e demografia",
    className: "md:col-span-2 lg:col-span-1",
  },
  {
    icon: Globe,
    title: "Multi-Plataforma",
    description: "Integração com Twitter, Instagram, Facebook, TikTok, LinkedIn e mais",
    className: "md:col-span-2 lg:col-span-1",
  },
  {
    icon: Shield,
    title: "Segurança LGPD",
    description: "Conformidade total com LGPD e GDPR para proteção de dados",
    className: "md:col-span-1",
  },
  {
    icon: Zap,
    title: "Alertas Inteligentes",
    description: "Notificações automáticas para picos de menções e crises de imagem",
    className: "md:col-span-1",
  },
  {
    icon: Lock,
    title: "Dashboard Admin",
    description: "Gestão completa de usuários, assinaturas e relatórios customizados",
    className: "md:col-span-2 lg:col-span-1",
  },
];

export const BentoFeatures = () => {
  return (
    <section className="container mx-auto px-4 py-20">
      <div className="text-center mb-12 animate-fade-in-up">
        <h2 className="text-3xl md:text-5xl font-bold mb-4">
          Recursos <span className="gradient-text">Poderosos</span> de Análise
        </h2>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
          Tecnologia de ponta para transformar dados em insights estratégicos
        </p>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <Card
              key={feature.title}
              className={cn(
                "p-8 hover-lift hover-glow transition-all duration-300 group animate-fade-in-up",
                feature.className
              )}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <div className="space-y-4">
                <div className="p-3 bg-gradient-primary rounded-lg inline-block group-hover:scale-110 transition-transform duration-300">
                  <Icon className="h-8 w-8 text-white" />
                </div>
                <h3 className="text-xl font-bold">{feature.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
};
