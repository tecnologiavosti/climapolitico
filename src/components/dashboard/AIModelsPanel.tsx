import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, Target, TrendingUp } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface AIModel {
  name: string;
  displayName: string;
  weight: number;
  specialization: string;
  icon: React.ReactNode;
  color: string;
}

const AI_MODELS: AIModel[] = [
  {
    name: "google/gemini-3-pro-preview",
    displayName: "Gemini 3 Pro",
    weight: 0.95,
    specialization: "Raciocínio Complexo de Próxima Geração",
    icon: <Brain className="h-4 w-4" />,
    color: "hsl(var(--chart-1))"
  },
  {
    name: "openai/gpt-5",
    displayName: "GPT-5",
    weight: 0.90,
    specialization: "Máxima Precisão e Nuance",
    icon: <Target className="h-4 w-4" />,
    color: "hsl(var(--chart-2))"
  },
  {
    name: "google/gemini-2.5-pro",
    displayName: "Gemini 2.5 Pro",
    weight: 0.85,
    specialization: "Alta Qualidade Multimodal",
    icon: <Brain className="h-4 w-4" />,
    color: "hsl(var(--chart-3))"
  },
  {
    name: "google/gemini-2.5-flash",
    displayName: "Gemini 2.5 Flash",
    weight: 0.75,
    specialization: "Velocidade e Eficiência",
    icon: <Zap className="h-4 w-4" />,
    color: "hsl(var(--chart-4))"
  },
  {
    name: "openai/gpt-5-mini",
    displayName: "GPT-5 Mini",
    weight: 0.70,
    specialization: "Custo-Benefício Otimizado",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "hsl(var(--chart-5))"
  },
  {
    name: "openai/gpt-5-nano",
    displayName: "GPT-5 Nano",
    weight: 0.60,
    specialization: "Ultra-Rápido para Volume",
    icon: <Zap className="h-4 w-4" />,
    color: "hsl(var(--warning))"
  }
];

export function AIModelsPanel() {
  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Sistema Multi-IA de Análise
        </h3>
        <p className="text-sm text-muted-foreground">
          6 modelos de IA trabalhando em paralelo com votação ponderada
        </p>
      </div>

      <div className="space-y-3">
        {AI_MODELS.map((model) => (
          <TooltipProvider key={model.name}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center justify-between p-3 border border-border rounded-lg hover:bg-muted/50 transition-colors cursor-help">
                  <div className="flex items-center gap-3">
                    <div 
                      className="p-2 rounded-lg" 
                      style={{ backgroundColor: `${model.color}20` }}
                    >
                      <div style={{ color: model.color }}>
                        {model.icon}
                      </div>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{model.displayName}</p>
                      <p className="text-xs text-muted-foreground">{model.specialization}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">
                      Peso: {(model.weight * 100).toFixed(0)}%
                    </Badge>
                  </div>
                </div>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="font-medium mb-1">{model.displayName}</p>
                <p className="text-xs text-muted-foreground">{model.specialization}</p>
                <p className="text-xs mt-2">
                  Peso no sistema de votação: <span className="font-medium">{model.weight}</span>
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </div>

      <div className="mt-4 p-3 bg-muted/50 rounded-lg">
        <p className="text-xs text-muted-foreground">
          <strong>Sistema de Agregação:</strong> Os resultados de todos os modelos são combinados
          usando votação ponderada baseada na confiança e peso de cada modelo, garantindo
          análises mais precisas e confiáveis.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="p-2 bg-success/10 rounded-lg">
          <p className="text-2xl font-bold text-success">6</p>
          <p className="text-xs text-muted-foreground">Modelos Ativos</p>
        </div>
        <div className="p-2 bg-primary/10 rounded-lg">
          <p className="text-2xl font-bold text-primary">~92%</p>
          <p className="text-xs text-muted-foreground">Precisão Média</p>
        </div>
        <div className="p-2 bg-warning/10 rounded-lg">
          <p className="text-2xl font-bold text-warning">3x</p>
          <p className="text-xs text-muted-foreground">Mais Modelos</p>
        </div>
      </div>
    </Card>
  );
}