import { Card } from "@/components/ui/card";
import { TrendingUp, Users, MessageSquare, Activity } from "lucide-react";

const stats = [
  {
    title: "Menções Analisadas",
    value: "2.4M+",
    change: "+12.5%",
    icon: MessageSquare,
    trend: "up",
  },
  {
    title: "Candidatos Monitorados",
    value: "350+",
    change: "+8.2%",
    icon: Users,
    trend: "up",
  },
  {
    title: "Taxa de Precisão",
    value: "94.8%",
    change: "+2.1%",
    icon: Activity,
    trend: "up",
  },
  {
    title: "ROI Médio",
    value: "340%",
    change: "+15.3%",
    icon: TrendingUp,
    trend: "up",
  },
];

export const StatsGrid = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => {
        const Icon = stat.icon;
        return (
          <Card
            key={index}
            className="p-6 hover:shadow-lg transition-all duration-300 border-border/50"
          >
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">
                  {stat.title}
                </p>
                <p className="text-3xl font-bold">{stat.value}</p>
                <p className="text-sm text-success flex items-center gap-1">
                  <TrendingUp className="h-4 w-4" />
                  {stat.change} vs mês anterior
                </p>
              </div>
              <div className="p-3 bg-gradient-primary rounded-lg">
                <Icon className="h-6 w-6 text-white" />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
};
