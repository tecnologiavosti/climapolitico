import { useEffect, lazy, Suspense } from "react";
import { useNavigate, Routes, Route } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSessionHealthCheck } from "@/hooks/useSessionHealthCheck";
import { useAutomaticCollection } from "@/hooks/useAutomaticCollection";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageLoader } from "@/components/ui/page-loader";
import { useOnboarding, OnboardingStep } from "@/hooks/useOnboarding";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

// Lazy-load das rotas: cada página só baixa o JS quando o usuário entra nela.
// Reduz drasticamente o bundle inicial do dashboard.
const Overview = lazy(() => import("./dashboard/Overview"));
const Candidates = lazy(() => import("./dashboard/Candidates"));
const AnalysisHistory = lazy(() => import("./dashboard/AnalysisHistory"));
const Analytics = lazy(() => import("./dashboard/Analytics"));
const SpeechAnalysis = lazy(() => import("./dashboard/SpeechAnalysis"));
const CandidateRanking = lazy(() => import("./dashboard/CandidateRanking"));
const Admin = lazy(() => import("./dashboard/Admin"));
const AdminApiSettings = lazy(() => import("./dashboard/AdminApiSettings"));
const UndecidedAnalysis = lazy(() => import("./dashboard/UndecidedAnalysis"));
const SocialMediaReport = lazy(() => import("./dashboard/SocialMediaReport"));
const AIInsights = lazy(() => import("./dashboard/AIInsights"));
const CollectionStatus = lazy(() => import("./dashboard/CollectionStatus"));
const TraceabilityReport = lazy(() => import("./dashboard/TraceabilityReport"));
const ScheduledReports = lazy(() => import("./dashboard/ScheduledReports"));
const ReportTemplates = lazy(() => import("./dashboard/ReportTemplates"));
const RealTimeMonitor = lazy(() => import("./dashboard/RealTimeMonitor"));
const CandidateSummary = lazy(() => import("./dashboard/CandidateSummary"));
const RejectionAnalysis = lazy(() => import("./dashboard/RejectionAnalysis"));
const NarrativeRecommendations = lazy(() => import("./dashboard/NarrativeRecommendations"));
const CandidateComparison = lazy(() => import("./dashboard/CandidateComparison"));
const EventReport = lazy(() => import("./dashboard/EventReport"));
const Brand24Collector = lazy(() => import("./dashboard/Brand24Collector"));
const CandidatesCatalog = lazy(() => import("./dashboard/CandidatesCatalog"));
const Settings = lazy(() => import("./dashboard/Settings"));
const Notifications = lazy(() => import("./dashboard/Notifications"));
const DataCollectionMethodology = lazy(() => import("./dashboard/DataCollectionMethodology"));
const onboardingSteps: OnboardingStep[] = [
  {
    target: '[data-onboarding="sidebar"]',
    title: "Navegação Principal",
    description: "Use este menu para navegar entre as diferentes seções da plataforma. Você pode colapsar o menu clicando no ícone de menu.",
    position: "right",
  },
  {
    target: '[data-onboarding="overview"]',
    title: "Visão Geral",
    description: "Aqui você encontra um resumo dos seus candidatos, análises recentes e insights principais.",
    position: "right",
  },
  {
    target: '[data-onboarding="candidates"]',
    title: "Candidatos",
    description: "Gerencie seus candidatos e acompanhe suas métricas de engajamento e sentimento nas redes sociais.",
    position: "right",
  },
  {
    target: '[data-onboarding="ai-insights"]',
    title: "Insights da IA",
    description: "Receba recomendações inteligentes e análises preditivas baseadas em IA para otimizar suas estratégias.",
    position: "right",
  },
  {
    target: '[data-onboarding="breadcrumbs"]',
    title: "Navegação Contextual",
    description: "Use o breadcrumb para entender onde você está e navegar rapidamente entre seções.",
    position: "bottom",
  },
  {
    target: '[data-onboarding="user-menu"]',
    title: "Menu de Usuário",
    description: "Acesse suas configurações, preferências e faça logout por aqui.",
    position: "bottom",
  },
];

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  useSessionHealthCheck();
  useAutomaticCollection();

  const onboarding = useOnboarding(onboardingSteps, !!user);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return <PageLoader />;
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-secondary">
        <div data-onboarding="sidebar">
          <AppSidebar />
        </div>
        
        <div className="flex-1 flex flex-col">
          <header className="border-b glass sticky top-0 z-10">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <div data-onboarding="breadcrumbs">
                  <Breadcrumbs />
                </div>
              </div>
              <div className="flex items-center gap-2" data-onboarding="user-menu">
                <Button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  variant="outline"
                  size="icon"
                  aria-label="Alternar tema"
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button onClick={signOut} variant="outline" size="sm" className="hover-lift">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 animate-fade-in">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/candidate-summary" element={<CandidateSummary />} />
                <Route path="/rejection-analysis" element={<RejectionAnalysis />} />
                <Route path="/narrative-recommendations" element={<NarrativeRecommendations />} />
                <Route path="/candidate-comparison" element={<CandidateComparison />} />
                <Route path="/event-report" element={<EventReport />} />
                <Route path="/candidates" element={<Candidates />} />
                <Route path="/candidates-catalog" element={<CandidatesCatalog />} />
                <Route path="/analytics-advanced" element={<Analytics />} />
                <Route path="/ranking" element={<CandidateRanking />} />
                <Route path="/collection-status" element={<CollectionStatus />} />
                <Route path="/realtime-monitor" element={<RealTimeMonitor />} />
                <Route path="/brand24-collector" element={<Brand24Collector />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/admin/api-settings" element={<AdminApiSettings />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/subscription" element={
                  <div className="text-center py-12">
                    <h3 className="text-2xl font-bold mb-2">Assinatura</h3>
                    <p className="text-muted-foreground">Em desenvolvimento</p>
                  </div>
                } />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Suspense>
          </main>
        </div>
      </div>

      <OnboardingTour
        isActive={onboarding.isActive}
        currentStep={onboarding.currentStep}
        totalSteps={onboarding.totalSteps}
        step={onboarding.step}
        targetElement={onboarding.targetElement}
        onNext={onboarding.next}
        onPrevious={onboarding.previous}
        onSkip={onboarding.skip}
      />
    </SidebarProvider>
  );
};

export default Dashboard;
