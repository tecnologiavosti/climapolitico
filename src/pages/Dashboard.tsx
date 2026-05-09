import { useEffect, lazy, Suspense } from "react";
import { useNavigate, Routes, Route } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSessionHealthCheck } from "@/hooks/useSessionHealthCheck";
import { Button } from "@/components/ui/button";
import { LogOut, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageLoader } from "@/components/ui/page-loader";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { onboardingSteps, validateOnboardingTargets } from "@/config/onboardingSteps";

// Lazy-load das rotas: cada página só baixa o JS quando o usuário entra nela.
const Overview = lazy(() => import("./dashboard/Overview"));
const Candidates = lazy(() => import("./dashboard/Candidates"));
const Analytics = lazy(() => import("./dashboard/Analytics"));
const CandidateRanking = lazy(() => import("./dashboard/CandidateRanking"));
const Admin = lazy(() => import("./dashboard/Admin"));
const AdminApiSettings = lazy(() => import("./dashboard/AdminApiSettings"));
const AIInsights = lazy(() => import("./dashboard/AIInsights"));
const CollectionStatus = lazy(() => import("./dashboard/CollectionStatus"));
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
const RegionalAnalysis = lazy(() => import("./dashboard/RegionalAnalysis"));
const SocialFeeds = lazy(() => import("./dashboard/SocialFeeds"));
const SystemHealth = lazy(() => import("./dashboard/SystemHealth"));
const Observability = lazy(() => import("./dashboard/Observability"));
const Operations = lazy(() => import("./dashboard/Operations"));
const Exports = lazy(() => import("./dashboard/Exports"));
const SLO = lazy(() => import("./dashboard/SLO"));
const WorkerTokens = lazy(() => import("./dashboard/WorkerTokens"));

/** Wraps a lazy route element in a per-route error boundary. */
const wrap = (name: string, El: React.ComponentType) => (
  <RouteErrorBoundary routeName={name}>
    <El />
  </RouteErrorBoundary>
);

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  useSessionHealthCheck();

  const onboarding = useOnboarding(onboardingSteps, !!user);

  useEffect(() => {
    if (!authLoading && !user) navigate("/auth");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    validateOnboardingTargets();
  }, []);

  if (authLoading) return <PageLoader />;

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
                <SidebarTrigger aria-label="Abrir ou fechar menu lateral" />
                <div data-onboarding="breadcrumbs">
                  <Breadcrumbs />
                </div>
              </div>
              <div className="flex items-center gap-2" data-onboarding="user-menu">
                <Button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  variant="outline"
                  size="icon"
                  aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button onClick={signOut} variant="outline" size="sm" className="hover-lift" aria-label="Sair da conta">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 animate-fade-in">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={wrap("Overview", Overview)} />
                <Route path="/candidate-summary" element={wrap("CandidateSummary", CandidateSummary)} />
                <Route path="/rejection-analysis" element={wrap("RejectionAnalysis", RejectionAnalysis)} />
                <Route path="/narrative-recommendations" element={wrap("NarrativeRecommendations", NarrativeRecommendations)} />
                <Route path="/candidate-comparison" element={wrap("CandidateComparison", CandidateComparison)} />
                <Route path="/event-report" element={wrap("EventReport", EventReport)} />
                <Route path="/candidates" element={wrap("Candidates", Candidates)} />
                <Route path="/candidates-catalog" element={wrap("CandidatesCatalog", CandidatesCatalog)} />
                <Route path="/analytics-advanced" element={wrap("Analytics", Analytics)} />
                <Route path="/ranking" element={wrap("Ranking", CandidateRanking)} />
                <Route path="/collection-status" element={wrap("CollectionStatus", CollectionStatus)} />
                <Route path="/realtime-monitor" element={wrap("RealTimeMonitor", RealTimeMonitor)} />
                <Route path="/brand24-collector" element={wrap("Brand24Collector", Brand24Collector)} />
                <Route path="/ai-insights" element={wrap("AIInsights", AIInsights)} />
                <Route path="/admin" element={wrap("Admin", Admin)} />
                <Route path="/admin/api-settings" element={wrap("AdminApiSettings", AdminApiSettings)} />
                <Route path="/system-health" element={wrap("SystemHealth", SystemHealth)} />
                <Route path="/observability" element={wrap("Observability", Observability)} />
                <Route path="/operations" element={wrap("Operations", Operations)} />
                <Route path="/exports" element={wrap("Exports", Exports)} />
                <Route path="/slo" element={wrap("SLO", SLO)} />
                <Route path="/notifications" element={wrap("Notifications", Notifications)} />
                <Route path="/data-collection-methodology" element={wrap("DataCollectionMethodology", DataCollectionMethodology)} />
                <Route path="/regional-analysis" element={wrap("RegionalAnalysis", RegionalAnalysis)} />
                <Route path="/social-feeds" element={wrap("SocialFeeds", SocialFeeds)} />
                <Route path="/settings" element={wrap("Settings", Settings)} />
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
