import { useEffect } from "react";
import { useNavigate, Routes, Route } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import Overview from "./dashboard/Overview";
import Candidates from "./dashboard/Candidates";
import AnalysisHistory from "./dashboard/AnalysisHistory";
import Analytics from "./dashboard/Analytics";
import SpeechAnalysis from "./dashboard/SpeechAnalysis";
import CandidateRanking from "./dashboard/CandidateRanking";
import Admin from "./dashboard/Admin";

const Dashboard = () => {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-secondary">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <SidebarTrigger />
                <h2 className="text-lg font-semibold">Dashboard</h2>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={signOut} variant="outline" size="sm">
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </Button>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 p-6">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/candidates" element={<Candidates />} />
              <Route path="/analytics" element={<AnalysisHistory />} />
              <Route path="/analytics-advanced" element={<Analytics />} />
              <Route path="/speech-analysis" element={<SpeechAnalysis />} />
              <Route path="/ranking" element={<CandidateRanking />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/ai" element={
                <div className="text-center py-12">
                  <h3 className="text-2xl font-bold mb-2">IA & Insights</h3>
                  <p className="text-muted-foreground">Em desenvolvimento</p>
                </div>
              } />
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
    </SidebarProvider>
  );
};

export default Dashboard;
