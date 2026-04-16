import { useEffect } from "react";
import { useNavigate, Routes, Route } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSessionHealthCheck } from "@/hooks/useSessionHealthCheck";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageLoader } from "@/components/ui/page-loader";
import { useOnboarding, OnboardingStep } from "@/hooks/useOnboarding";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import Overview from "./dashboard/Overview";
import Candidates from "./dashboard/Candidates";
import AnalysisHistory from "./dashboard/AnalysisHistory";
import Analytics from "./dashboard/Analytics";
import SpeechAnalysis from "./dashboard/SpeechAnalysis";
import CandidateRanking from "./dashboard/CandidateRanking";
import Admin from "./dashboard/Admin";
import AdminApiSettings from "./dashboard/AdminApiSettings";
import UndecidedAnalysis from "./dashboard/UndecidedAnalysis";
import SocialMediaReport from "./dashboard/SocialMediaReport";
import AIInsights from "./dashboard/AIInsights";
import CollectionStatus from "./dashboard/CollectionStatus";
import TraceabilityReport from "./dashboard/TraceabilityReport";
import ScheduledReports from "./dashboard/ScheduledReports";
import ReportTemplates from "./dashboard/ReportTemplates";
import RealTimeMonitor from "./dashboard/RealTimeMonitor";
import CandidateSummary from "./dashboard/CandidateSummary";
import RejectionAnalysis from "./dashboard/RejectionAnalysis";
import NarrativeRecommendations from "./dashboard/NarrativeRecommendations";
import CandidateComparison from "./dashboard/CandidateComparison";
import EventReport from "./dashboard/EventReport";
import Brand24Collector from "./dashboard/Brand24Collector";
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
  useSessionHealthCheck();

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
          {/* Header */}
          <header className="border-b glass sticky top-0 z-10">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
                <div data-onboarding="breadcrumbs">
                  <Breadcrumbs />
                </div>
              </div>
              <div className="flex items-center gap-2" data-onboarding="user-menu">
                <Button onClick={signOut} variant="outline" size="sm" className="hover-lift">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </Button>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6 animate-fade-in">
            <Routes>
              {/* Rotas ativas */}
              <Route path="/" element={<Overview />} />
              <Route path="/candidate-summary" element={<CandidateSummary />} />
              <Route path="/rejection-analysis" element={<RejectionAnalysis />} />
              <Route path="/narrative-recommendations" element={<NarrativeRecommendations />} />
              <Route path="/candidate-comparison" element={<CandidateComparison />} />
              <Route path="/event-report" element={<EventReport />} />
              <Route path="/candidates" element={<Candidates />} />
              <Route path="/analytics-advanced" element={<Analytics />} />
              <Route path="/ranking" element={<CandidateRanking />} />
              <Route path="/collection-status" element={<CollectionStatus />} />
              <Route path="/realtime-monitor" element={<RealTimeMonitor />} />
              <Route path="/brand24-collector" element={<Brand24Collector />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/api-settings" element={<AdminApiSettings />} />
              
              {/* Rotas temporariamente desativadas - código mantido para reativação futura */}
              {/* <Route path="/analytics" element={<AnalysisHistory />} /> */}
              {/* <Route path="/speech-analysis" element={<ErrorBoundary><SpeechAnalysis /></ErrorBoundary>} /> */}
              {/* <Route path="/undecided" element={<ErrorBoundary><UndecidedAnalysis /></ErrorBoundary>} /> */}
              {/* <Route path="/social-media-report" element={<SocialMediaReport />} /> */}
              {/* <Route path="/traceability-report" element={<TraceabilityReport />} /> */}
              {/* <Route path="/scheduled-reports" element={<ScheduledReports />} /> */}
              {/* <Route path="/report-templates" element={<ReportTemplates />} /> */}
              {/* <Route path="/ai" element={<AIInsights />} /> */}
              <Route path="/notifications" element={
                <div className="text-center py-12">
                  <h3 className="text-2xl font-bold mb-2">Notificações</h3>
                  <p className="text-muted-foreground">Em desenvolvimento</p>
                </div>
              } />
              <Route path="/subscription" element={
                <div className="text-center py-12">
                  <h3 className="text-2xl font-bold mb-2">Assinatura</h3>
                  <p className="text-muted-foreground">Em desenvolvimento</p>
                </div>
              } />
              <Route path="/settings" element={
                <div className="text-center py-12">
                  <h3 className="text-2xl font-bold mb-2">Configurações</h3>
                  <p className="text-muted-foreground">Em desenvolvimento</p>
                </div>
              } />
            </Routes>
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
