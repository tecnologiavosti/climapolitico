import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrendingUp, TrendingDown, Users, MessageSquare, Eye, AlertCircle } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const sentimentData = [
  { name: "Seg", positive: 45, negative: 20, neutral: 35 },
  { name: "Ter", positive: 52, negative: 18, neutral: 30 },
  { name: "Qua", positive: 48, negative: 25, neutral: 27 },
  { name: "Qui", positive: 60, negative: 15, neutral: 25 },
  { name: "Sex", positive: 55, negative: 22, neutral: 23 },
  { name: "Sab", positive: 50, negative: 20, neutral: 30 },
  { name: "Dom", positive: 58, negative: 17, neutral: 25 },
];

const candidateData = [
  { name: "Candidato A", mentions: 1250, sentiment: 65 },
  { name: "Candidato B", mentions: 980, sentiment: 45 },
  { name: "Candidato C", mentions: 750, sentiment: 72 },
  { name: "Candidato D", mentions: 620, sentiment: 38 },
];

const ideologyData = [
  { name: "Esquerda", value: 35, color: "#ef4444" },
  { name: "Centro", value: 25, color: "#f59e0b" },
  { name: "Direita", value: 30, color: "#3b82f6" },
  { name: "Neutro", value: 10, color: "#6b7280" },
];

export default function Overview() {
  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Menções Total</p>
              <p className="text-3xl font-bold mt-2">3,245</p>
              <div className="flex items-center gap-1 mt-2 text-success text-sm">
                <TrendingUp className="h-4 w-4" />
                <span>+12.5%</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <MessageSquare className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Candidatos</p>
              <p className="text-3xl font-bold mt-2">12</p>
              <div className="flex items-center gap-1 mt-2 text-success text-sm">
                <TrendingUp className="h-4 w-4" />
                <span>+2 novos</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <Users className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Sentimento Médio</p>
              <p className="text-3xl font-bold mt-2">68%</p>
              <div className="flex items-center gap-1 mt-2 text-success text-sm">
                <TrendingUp className="h-4 w-4" />
                <span>+5.2%</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Visualizações</p>
              <p className="text-3xl font-bold mt-2">45.2K</p>
              <div className="flex items-center gap-1 mt-2 text-destructive text-sm">
                <TrendingDown className="h-4 w-4" />
                <span>-2.3%</span>
              </div>
            </div>
            <div className="p-3 bg-gradient-primary rounded-lg">
              <Eye className="h-6 w-6 text-white" />
            </div>
          </div>
        </Card>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sentiment Over Time */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold">Sentimento ao Longo do Tempo</h3>
            <p className="text-sm text-muted-foreground">Últimos 7 dias</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={sentimentData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="positive" stroke="#22c55e" strokeWidth={2} />
              <Line type="monotone" dataKey="negative" stroke="#ef4444" strokeWidth={2} />
              <Line type="monotone" dataKey="neutral" stroke="#6b7280" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Ideology Distribution */}
        <Card className="p-6">
          <div className="mb-4">
            <h3 className="text-lg font-bold">Distribuição Ideológica</h3>
            <p className="text-sm text-muted-foreground">Análise do público</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={ideologyData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {ideologyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Candidates Performance */}
      <Card className="p-6">
        <div className="mb-4">
          <h3 className="text-lg font-bold">Performance dos Candidatos</h3>
          <p className="text-sm text-muted-foreground">Menções vs Sentimento</p>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={candidateData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis yAxisId="left" orientation="left" />
            <YAxis yAxisId="right" orientation="right" />
            <Tooltip />
            <Bar yAxisId="left" dataKey="mentions" fill="hsl(var(--primary))" />
            <Bar yAxisId="right" dataKey="sentiment" fill="hsl(var(--success))" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Alerts */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle className="h-5 w-5 text-warning" />
          <h3 className="text-lg font-bold">Alertas Recentes</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex-1">
              <p className="font-medium">Pico de menções negativas</p>
              <p className="text-sm text-muted-foreground">Candidato B - 15:30</p>
            </div>
            <Badge variant="destructive">Crítico</Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex-1">
              <p className="font-medium">Crescimento acelerado</p>
              <p className="text-sm text-muted-foreground">Candidato C - 12:15</p>
            </div>
            <Badge className="bg-success">Positivo</Badge>
          </div>
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
            <div className="flex-1">
              <p className="font-medium">Nova tendência detectada</p>
              <p className="text-sm text-muted-foreground">Hashtag #ReformaTributária - 10:45</p>
            </div>
            <Badge className="bg-warning">Atenção</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
