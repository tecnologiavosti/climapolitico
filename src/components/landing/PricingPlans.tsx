import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Crown, Check } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type Plan = {
  id: string;
  tier: string;
  display_name: string;
  price_monthly: number;
  features: string[];
  max_candidates: number;
  max_updates_per_month: number;
  sort_order: number;
  is_active: boolean;
  visible_in_homepage: boolean;
};

const WA = (planName: string) =>
  `https://wa.me/556198117985?text=${encodeURIComponent(`Olá! Tenho interesse no plano ${planName}`)}`;

const fmtPrice = (v: number) =>
  v <= 0 ? "Sob consulta" : `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0 })}`;

export function PricingPlans() {
  const { data, isLoading } = useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data as any as Plan[]).filter((p) => p.visible_in_homepage !== false);
    },
  });

  if (isLoading) {
    return (
      <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-96" />)}
      </div>
    );
  }

  const plans = data ?? [];
  if (plans.length === 0) return null;

  return (
    <div className={`grid gap-8 max-w-6xl mx-auto items-stretch ${plans.length >= 3 ? "md:grid-cols-3" : plans.length === 2 ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
      {plans.map((p, idx) => {
        const isVip = p.tier === "vip";
        const isPro = p.tier === "pro";
        const features = Array.isArray(p.features) ? p.features : [];
        return (
          <Card
            key={p.id}
            className={`p-8 hover-lift transition-all duration-300 border-2 relative animate-fade-in-up flex flex-col h-full ${
              isVip
                ? "border-amber-400 shadow-[0_0_40px_rgba(251,191,36,0.35)] bg-gradient-to-br from-amber-50/40 via-background to-yellow-100/20 dark:from-amber-950/20 dark:to-yellow-900/10"
                : isPro
                ? "border-primary hover-glow"
                : "hover-glow"
            }`}
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            {isVip && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-amber-500 to-yellow-500 text-white shadow-lg">
                <Crown className="h-3 w-3 mr-1" /> VIP
              </Badge>
            )}
            {isPro && !isVip && (
              <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-primary animate-glow-pulse">
                Mais Popular
              </Badge>
            )}
            <div className="flex flex-col flex-1 space-y-6">
              <div>
                <h3 className={`text-2xl font-bold mb-2 ${isVip ? "text-amber-600 dark:text-amber-400" : ""}`}>
                  {p.display_name}
                </h3>
                <div className="text-3xl font-extrabold">
                  {fmtPrice(p.price_monthly)}
                  {p.price_monthly > 0 && <span className="text-sm font-normal text-muted-foreground">/mês</span>}
                </div>
              </div>
              <ul className="space-y-3 text-sm flex-1">
                {features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Check className={`h-4 w-4 shrink-0 ${isVip ? "text-amber-500" : "text-primary"}`} />
                    {f}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3 mt-auto">
                <Button
                  className={`flex-1 ${
                    isVip
                      ? "bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-white shadow-lg"
                      : isPro
                      ? "bg-gradient-primary hover-glow"
                      : ""
                  }`}
                  variant={isPro || isVip ? "default" : "outline"}
                  onClick={() => { window.location.href = WA(p.display_name); }}
                >
                  {isVip ? "Falar com equipe VIP" : "Saiba mais"}
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
