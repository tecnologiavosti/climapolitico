import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, Users, MessageSquare, TrendingUp } from "lucide-react";
import { SocialMediaReportData } from "@/pages/dashboard/SocialMediaReport";

interface SocialMediaKPIsProps {
  data: SocialMediaReportData[];
}

export function SocialMediaKPIs({ data }: SocialMediaKPIsProps) {
  const totalNetworks = data.length;
  const totalProfiles = data.reduce((sum, item) => sum + item.uniqueProfiles, 0);
  const totalMentions = data.reduce((sum, item) => sum + item.totalMentions, 0);
  const mostActiveNetwork = data.length > 0 
    ? data.reduce((max, item) => item.totalMentions > max.totalMentions ? item : max, data[0])
    : null;

  const kpis = [
    {
      title: "Redes Sociais",
      value: totalNetworks.toString(),
      description: "Plataformas analisadas",
      icon: Globe,
      color: "text-primary"
    },
    {
      title: "Perfis Únicos",
      value: totalProfiles.toLocaleString('pt-BR'),
      description: "Usuários que mencionaram",
      icon: Users,
      color: "text-blue-600"
    },
    {
      title: "Total de Menções",
      value: totalMentions.toLocaleString('pt-BR'),
      description: "Posts + comentários",
      icon: MessageSquare,
      color: "text-purple-600"
    },
    {
      title: "Rede Mais Ativa",
      value: mostActiveNetwork?.network || "N/A",
      description: `${mostActiveNetwork?.totalMentions.toLocaleString('pt-BR') || 0} menções`,
      icon: TrendingUp,
      color: "text-green-600"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {kpis.map((kpi, index) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {kpi.title}
            </CardTitle>
            <kpi.icon className={`h-4 w-4 ${kpi.color}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{kpi.value}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpi.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
