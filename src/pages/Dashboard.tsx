import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, LogOut, User, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Profile {
  full_name: string | null;
  organization: string | null;
  role_title: string | null;
}

interface Subscription {
  tier: string;
  status: string;
  max_candidates: number;
  max_updates_per_month: number;
  updates_used_this_month: number;
}

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      loadUserData();
    }
  }, [user]);

  const loadUserData = async () => {
    try {
      const [profileResult, subscriptionResult] = await Promise.all([
        supabase
          .from("profiles")
          .select("full_name, organization, role_title")
          .eq("id", user?.id)
          .single(),
        supabase
          .from("subscriptions")
          .select("tier, status, max_candidates, max_updates_per_month, updates_used_this_month")
          .eq("user_id", user?.id)
          .single(),
      ]);

      if (profileResult.data) setProfile(profileResult.data);
      if (subscriptionResult.data) setSubscription(subscriptionResult.data);
    } catch (error) {
      console.error("Error loading user data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-secondary">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-primary rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Clima Político
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => navigate("/test-ai")} variant="outline" size="sm">
              Testar IA
            </Button>
            <Button onClick={signOut} variant="outline" size="sm">
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Welcome Section */}
          <div>
            <h2 className="text-3xl font-bold mb-2">
              Bem-vindo, {profile?.full_name || user?.email}! 👋
            </h2>
            <p className="text-muted-foreground">
              Este é o seu dashboard de análise política
            </p>
          </div>

          {/* Profile & Subscription Cards */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Profile Card */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gradient-primary rounded-lg">
                  <User className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-4">Seu Perfil</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Nome:</span>{" "}
                      <span className="font-medium">
                        {profile?.full_name || "Não informado"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Email:</span>{" "}
                      <span className="font-medium">{user?.email}</span>
                    </div>
                    {profile?.organization && (
                      <div>
                        <span className="text-muted-foreground">Organização:</span>{" "}
                        <span className="font-medium">{profile.organization}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>

            {/* Subscription Card */}
            <Card className="p-6">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-gradient-primary rounded-lg">
                  <BarChart3 className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-4">Sua Assinatura</h3>
                  {subscription ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Plano:</span>
                        <span className="font-bold text-primary uppercase">
                          {subscription.tier}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status:</span>
                        <span className="font-medium capitalize">
                          {subscription.status}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Candidatos:
                        </span>
                        <span className="font-medium">
                          Até {subscription.max_candidates}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          Atualizações:
                        </span>
                        <span className="font-medium">
                          {subscription.updates_used_this_month} /{" "}
                          {subscription.max_updates_per_month}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Carregando informações da assinatura...
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Coming Soon Section */}
          <Card className="p-8 text-center">
            <h3 className="text-2xl font-bold mb-4">
              Dashboard em Desenvolvimento 🚀
            </h3>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Em breve você terá acesso a análises completas de candidatos,
              gráficos em tempo real, detecção de sentimento e muito mais!
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
