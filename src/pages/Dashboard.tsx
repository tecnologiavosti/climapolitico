import { useEffect, lazy, Suspense } from "react";
import { useNavigate, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useSessionHealthCheck } from "@/hooks/useSessionHealthCheck";
import { Button } from "@/components/ui/button";
import { LogOut, Sun, Moon, BarChart3 } from "lucide-react";
import { useTheme } from "next-themes";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { MobileBottomNav } from "@/components/MobileBottomNav";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { PageLoader } from "@/components/ui/page-loader";
import { useOnboarding } from "@/hooks/useOnboarding";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";
import { onboardingSteps, validateOnboardingTargets } from "@/config/onboardingSteps";
import { TrialCelebration } from "@/components/TrialCelebration";

// Lazy-load das rotas: cada página só baixa o JS quando o usuário entra nela.
const Overview = lazy(() => import("./dashboard/Overview"));
const Candidates = lazy(() => import("./dashboard/Candidates"));
const Analytics = lazy(() => import("./dashboard/Analytics"));
const CandidateRanking = lazy(() => import("./dashboard/CandidateRanking"));
const Admin = lazy(() => import("./dashboard/Admin"));
const AdminApiSettings = lazy(() => import("./dashboard/AdminApiSettings"));
const BlogAdmin = lazy(() => import("./dashboard/BlogAdmin"));
const AIInsights = lazy(() => import("./dashboard/AIInsights"));
const CollectionStatus = lazy(() => import("./dashboard/CollectionStatus"));
const RealTimeMonitor = lazy(() => import("./dashboard/RealTimeMonitor"));
const CandidateSummary = lazy(() => import("./dashboard/CandidateSummary"));
const RejectionAnalysis = lazy(() => import("./dashboard/RejectionAnalysis"));
const NarrativeRecommendations = lazy(() => import("./dashboard/NarrativeRecommendations"));
const CandidateComparison = lazy(() => import("./dashboard/CandidateComparison"));
const RadarPolitico = lazy(() => import("./dashboard/RadarPolitico"));
const Brand24Collector = lazy(() => import("./dashboard/Brand24Collector"));
const CandidatesCatalog = lazy(() => import("./dashboard/CandidatesCatalog"));
const Settings = lazy(() => import("./dashboard/Settings"));
const Notifications = lazy(() => import("./dashboard/Notifications"));
const DataCollectionMethodology = lazy(() => import("./dashboard/DataCollectionMethodology"));
const RegionalAnalysis = lazy(() => import("./dashboard/RegionalAnalysis"));
const SocialFeeds = lazy(() => import("./dashboard/SocialFeeds"));
const NetworkView = lazy(() => import("./dashboard/NetworkView"));
const SystemHealth = lazy(() => import("./dashboard/SystemHealth"));
const Observability = lazy(() => import("./dashboard/Observability"));
const Operations = lazy(() => import("./dashboard/Operations"));
const SLO = lazy(() => import("./dashboard/SLO"));
const WorkerTokens = lazy(() => import("./dashboard/WorkerTokens"));
const TenantAnalytics = lazy(() => import("./dashboard/TenantAnalytics"));
const DataDiagnostics = lazy(() => import("./dashboard/DataDiagnostics"));
const CollectorHealth = lazy(() => import("./dashboard/CollectorHealth"));

const HistoricalComparison = lazy(() => import("./dashboard/HistoricalComparison"));

const DataEnrichment = lazy(() => import("./dashboard/DataEnrichment"));


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

        <div className="flex-1 flex flex-col min-w-0">
          <header className="border-b glass sticky top-0 z-10">
            <div className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3 sm:py-4">
              <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                <SidebarTrigger aria-label="Abrir ou fechar menu lateral" className="hidden md:inline-flex" />
                <div className="flex items-center gap-2 md:hidden">
                  <div className="p-1.5 bg-gradient-primary rounded-lg">
                    <BarChart3 className="h-4 w-4 text-white" />
                  </div>
                  <span className="font-bold text-base bg-gradient-primary bg-clip-text text-transparent truncate">
                    Clima Político
                  </span>
                </div>
                <div data-onboarding="breadcrumbs" className="min-w-0 overflow-hidden hidden sm:block">
                  <Breadcrumbs />
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0" data-onboarding="user-menu">
                <Button
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  variant="outline"
                  size="icon"
                  aria-label={theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro"}
                >
                  {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                </Button>
                <Button onClick={signOut} variant="outline" size="sm" className="hover-lift" aria-label="Sair da conta">
                  <LogOut className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Sair</span>
                </Button>
              </div>
            </div>
          </header>

          <main className="flex-1 p-3 sm:p-6 pb-20 md:pb-6 animate-fade-in overflow-x-hidden">
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/" element={wrap("Overview", Overview)} />
                <Route path="/candidate-summary" element={wrap("CandidateSummary", CandidateSummary)} />
                <Route path="/rejection-analysis" element={wrap("RejectionAnalysis", RejectionAnalysis)} />
                <Route path="/narrative-recommendations" element={wrap("NarrativeRecommendations", NarrativeRecommendations)} />
                <Route path="/candidate-comparison" element={wrap("CandidateComparison", CandidateComparison)} />
                <Route path="/radar-politico" element={wrap("RadarPolitico", RadarPolitico)} />
                <Route path="/pico-mencao" element={<Navigate to="/dashboard/radar-politico" replace />} />
                <Route path="/picos-mencao" element={<Navigate to="/dashboard/radar-politico" replace />} />
                <Route path="/candidates" element={wrap("Candidates", Candidates)} />
                <Route path="/candidates-catalog" element={wrap("CandidatesCatalog", CandidatesCatalog)} />
                
                <Route path="/ranking" element={wrap("Ranking", CandidateRanking)} />
                <Route path="/collection-status" element={wrap("CollectionStatus", CollectionStatus)} />
                <Route path="/realtime-monitor" element={wrap("RealTimeMonitor", RealTimeMonitor)} />
                <Route path="/brand24-collector" element={wrap("Brand24Collector", Brand24Collector)} />
                <Route path="/ai-insights" element={wrap("AIInsights", AIInsights)} />
                <Route path="/admin" element={wrap("Admin", Admin)} />
                <Route path="/admin/api-settings" element={wrap("AdminApiSettings", AdminApiSettings)} />
                <Route path="/admin/blog" element={wrap("BlogAdmin", BlogAdmin)} />
                <Route path="/system-health" element={wrap("SystemHealth", SystemHealth)} />
                <Route path="/observability" element={wrap("Observability", Observability)} />
                <Route path="/operations" element={wrap("Operations", Operations)} />
                <Route path="/slo" element={wrap("SLO", SLO)} />
                <Route path="/worker-tokens" element={wrap("WorkerTokens", WorkerTokens)} />
                <Route path="/tenant-analytics" element={wrap("TenantAnalytics", TenantAnalytics)} />
                <Route path="/data-diagnostics" element={wrap("DataDiagnostics", DataDiagnostics)} />
                <Route path="/collector-health" element={wrap("CollectorHealth", CollectorHealth)} />
                <Route path="/notifications" element={wrap("Notifications", Notifications)} />
                <Route path="/data-collection-methodology" element={wrap("DataCollectionMethodology", DataCollectionMethodology)} />
                <Route path="/regional-analysis" element={wrap("RegionalAnalysis", RegionalAnalysis)} />
                
                <Route path="/social-feeds" element={wrap("SocialFeeds", SocialFeeds)} />
                <Route path="/network-view" element={wrap("NetworkView", NetworkView)} />
                
                <Route path="/historical-comparison" element={wrap("HistoricalComparison", HistoricalComparison)} />
                
                <Route path="/data-enrichment" element={wrap("DataEnrichment", DataEnrichment)} />
                <Route path="/settings" element={wrap("Settings", Settings)} />
              </Routes>
            </Suspense>
          </main>
        </div>
        <MobileBottomNav />
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
      <TrialCelebration />
    </SidebarProvider>
  );
};

export default Dashboard;
