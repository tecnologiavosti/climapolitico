import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HeroSection } from "@/components/landing/HeroSection";
import { SocialProof } from "@/components/landing/SocialProof";
import { BentoFeatures } from "@/components/landing/BentoFeatures";
import { TrendingCandidates } from "@/components/landing/TrendingCandidates";
import { useNavigate } from "react-router-dom";
import { Sparkles, Gift, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getTrialStart, startTrial, getDaysLeft, hasMachineTrialStarted, requestTrialAfterLogin, queueTrialCelebration } from "@/lib/trial";


const WHATSAPP_LINKS = {
  basico:
    "https://wa.me/556198117983?text=Ol%C3%A1!%20Tenho%20interesse%20no%20plano%20B%C3%A1sico%20(R%24%20299%2Fm%C3%AAs)",
  pro: "https://wa.me/556198117983?text=Ol%C3%A1!%20Tenho%20interesse%20no%20plano%20Pro%20(R%24%20899%2Fm%C3%AAs)",
  enterprise:
    "https://wa.me/556198117983?text=Ol%C3%A1!%20Tenho%20interesse%20no%20plano%20Enterprise",
} as const;




const Index = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const trialStart = user ? getTrialStart(user.id) : null;
  const daysLeft = user ? getDaysLeft(user.id) : null;
  const hasActiveTrial = !!trialStart && (daysLeft ?? 0) > 0;
  const machineTrialStarted = hasMachineTrialStarted();

  const { data: subscription } = useQuery({
    queryKey: ["subscription-active", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("subscriptions")
        .select("status")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data;
    },
  });
  const hasActivePlan = subscription?.status === "active";
  const hideTrialCta = hasActiveTrial || machineTrialStarted || hasActivePlan;

  const handleFreeTrial = () => {
    if (!user) {
      requestTrialAfterLogin();
      toast.info("Faça login para ativar seu teste gratuito de 7 dias.");
      navigate("/auth");
      return;
    }

    if (!trialStart) {
      const startedAt = startTrial(user.id);
      if (!startedAt) {
        toast.error("Este dispositivo já ativou um teste gratuito. Escolha um plano para continuar.");
        return;
      }
      queueTrialCelebration(user.id);
      toast.success("Seu teste gratuito de 7 dias foi ativado!", {
        description: "Aproveite o acesso completo em climapolitico.com.br",
      });
      navigate("/dashboard/settings");
      return;
    }

    if ((daysLeft ?? 0) > 0) {
      toast.info(`Você ainda tem ${daysLeft} ${daysLeft === 1 ? "dia" : "dias"} de teste gratuito.`);
      navigate("/dashboard/settings");
    } else {
      toast.error("Seu período de teste gratuito expirou. Escolha um plano para continuar.");
    }
  };


  return (



    <div className="min-h-screen bg-gradient-secondary">
      {/* Hero Section */}
      <HeroSection />

      {/* Social Proof Stats */}
      <SocialProof />

      {/* Trending Candidates (public, dynamic) */}
      <TrendingCandidates />

      {/* Features Section */}
      <BentoFeatures />

      {/* Pricing Section */}
      <section className="container mx-auto px-4 py-20">
        {/* Free Trial Highlight — escondido se já houver teste ativo */}
        {!hasActiveTrial && !machineTrialStarted && (
          <div className="max-w-3xl mx-auto mb-14 animate-fade-in-up">
            <Card className="relative overflow-hidden border-2 border-primary/30 bg-gradient-to-br from-primary/10 via-background to-accent/10 p-6 sm:p-8 md:p-10 shadow-xl">
              <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-primary/20 blur-3xl" />
              <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative z-10 flex flex-col md:flex-row items-center gap-5 md:gap-6 text-center md:text-left">
                <div className="flex h-14 w-14 md:h-16 md:w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-primary shadow-lg">
                  <Gift className="h-7 w-7 md:h-8 md:w-8 text-primary-foreground" />
                </div>
                <div className="flex-1 space-y-2">
                  <Badge className="bg-gradient-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3 mr-1" /> Oferta de lançamento
                  </Badge>
                  <h3 className="text-xl sm:text-2xl md:text-3xl font-bold">
                    Teste grátis por <span className="gradient-text">7 dias</span>
                  </h3>
                  <p className="text-muted-foreground text-sm md:text-base">
                    Acesso completo ao <strong>climapolitico.com.br</strong> sem cartão de crédito.
                    Ative em segundos com sua conta.
                  </p>
                  <div className="flex items-center justify-center md:justify-start gap-1.5 text-xs text-muted-foreground pt-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                    Cancele quando quiser • Sem cobrança automática
                  </div>
                </div>
                <Button
                  size="lg"
                  className="w-full md:w-auto bg-gradient-primary hover-glow shadow-lg h-12 px-6 md:px-8 text-base font-semibold whitespace-nowrap"
                  onClick={handleFreeTrial}
                >
                  {user ? "Ativar 7 dias grátis" : "Entrar e ativar"}
                </Button>
              </div>
            </Card>
          </div>
        )}

        <div className="text-center mb-12 animate-fade-in-up">
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Planos <span className="gradient-text">Flexíveis</span>
          </h2>
          <p className="text-muted-foreground text-lg">Escolha o plano ideal para suas necessidades</p>
        </div>


        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {/* Basic Plan */}
          <Card
            className="p-8 hover-lift hover-glow transition-all duration-300 border-2 animate-fade-in-up"
            style={{ animationDelay: "0ms" }}
          >
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
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />3 atualizações/mês
                </li>
                <li className="flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Dashboard padrão
                </li>
              </ul>
              <Button
                className="w-full"
                variant="outline"
                onClick={() => {
                  window.location.href = WHATSAPP_LINKS.basico;
                }}
              >
                Saiba mais
              </Button>


            </div>
          </Card>

          {/* Pro Plan */}
          <Card
            className="p-8 hover-lift hover-glow transition-all duration-300 border-2 border-primary relative animate-fade-in-up"
            style={{ animationDelay: "100ms" }}
          >
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
              <Button
                className="w-full bg-gradient-primary hover-glow"
                onClick={() => {
                  window.location.href = WHATSAPP_LINKS.pro;
                }}
              >
                Saiba mais
              </Button>


            </div>
          </Card>

          {/* Enterprise Plan */}
          <Card
            className="p-8 hover-lift hover-glow transition-all duration-300 border-2 animate-fade-in-up"
            style={{ animationDelay: "200ms" }}
          >
            <div className="space-y-6">
              <div>
                <h3 className="text-2xl font-bold mb-2">Enterprise</h3>
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
              <Button
                className="w-full bg-gradient-primary hover-glow"
                onClick={() => {
                  window.location.href = WHATSAPP_LINKS.enterprise;
                }}
              >
                Saiba mais
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
            <h2 className="text-3xl md:text-5xl font-bold mb-4">Pronto para transformar sua estratégia política?</h2>
            <p className="text-xl md:text-2xl mb-8 opacity-90 max-w-2xl mx-auto">
              Comece hoje e tenha acesso a insights que fazem a diferença
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="hover-scale text-base h-12 px-8"
              onClick={() => navigate("/auth")}
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
