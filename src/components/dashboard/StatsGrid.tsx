import { StatCard } from "@/components/ui/stat-card";
import { TrendingUp, Users, MessageSquare, Activity } from "lucide-react";

const stats = [
  {
    title: "Menções Analisadas",
    value: "2.4M+",
    change: "+12.5% vs mês anterior",
    icon: MessageSquare,
    trend: "up" as const,
  },
  {
    title: "Candidatos Monitorados",
    value: "350+",
    change: "+8.2% vs mês anterior",
    icon: Users,
    trend: "up" as const,
  },
  {
    title: "Taxa de Precisão",
    value: "94.8%",
    change: "+2.1% vs mês anterior",
    icon: Activity,
    trend: "up" as const,
  },
  {
    title: "ROI Médio",
    value: "340%",
    change: "+15.3% vs mês anterior",
    icon: TrendingUp,
    trend: "up" as const,
  },
];

export const StatsGrid = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => (
        <div
          key={index}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <StatCard {...stat} animated={false} />
        </div>
      ))}
    </div>
  );
};
