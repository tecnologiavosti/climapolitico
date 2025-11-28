import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  TrendingUp,
  Brain,
  Target
} from "lucide-react";
import { useModelAgreement } from "@/hooks/useModelAgreement";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function AIModelAgreementDashboard() {
  const { data: metrics, isLoading } = useModelAgreement(50);

  if (isLoading) {
    return (
      <Card className="p-6">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-32 w-full" />
      </Card>
    );
  }

  if (!metrics) return null;

  const avgAgreement = (metrics.sentimentAgreement + metrics.ideologyAgreement) / 2;
  const agreementColor = avgAgreement >= 80 ? "text-success" : avgAgreement >= 60 ? "text-warning" : "text-destructive";
  const agreementIcon = avgAgreement >= 80 ? CheckCircle2 : avgAgreement >= 60 ? AlertTriangle : XCircle;
  const AgreementIcon = agreementIcon;

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Monitoramento de Concordância entre Modelos de IA
        </h3>
        <p className="text-sm text-muted-foreground">
          Análise de {metrics.totalAnalyses} análises recentes
        </p>
      </div>

      {/* Overall Agreement Score */}
      <div className="mb-6 p-4 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AgreementIcon className={`h-6 w-6 ${agreementColor}`} />
            <span className="font-bold text-lg">
              Taxa de Concordância Geral
            </span>
          </div>
          <span className={`text-3xl font-bold ${agreementColor}`}>
            {avgAgreement.toFixed(1)}%
          </span>
        </div>
        <Progress value={avgAgreement} className="h-2" />
      </div>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Sentiment Agreement */}
        <div className="p-4 border border-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Sentimento</span>
            </div>
            <Badge 
              variant={metrics.sentimentAgreement >= 80 ? "default" : "secondary"}
            >
              {metrics.sentimentAgreement.toFixed(1)}%
            </Badge>
          </div>
          <Progress value={metrics.sentimentAgreement} className="h-2 mb-2" />
          <p className="text-xs text-muted-foreground">
            {Math.round((metrics.sentimentAgreement / 100) * metrics.totalAnalyses)} de {metrics.totalAnalyses} análises com consenso
          </p>
        </div>

        {/* Ideology Agreement */}
        <div className="p-4 border border-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="font-medium text-sm">Ideologia</span>
            </div>
            <Badge 
              variant={metrics.ideologyAgreement >= 80 ? "default" : "secondary"}
            >
              {metrics.ideologyAgreement.toFixed(1)}%
            </Badge>
          </div>
          <Progress value={metrics.ideologyAgreement} className="h-2 mb-2" />
          <p className="text-xs text-muted-foreground">
            {Math.round((metrics.ideologyAgreement / 100) * metrics.totalAnalyses)} de {metrics.totalAnalyses} análises com consenso
          </p>
        </div>
      </div>

      {/* Distribution Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="p-4 border border-border rounded-lg">
          <h4 className="font-medium text-sm mb-3">Distribuição de Sentimentos</h4>
          <div className="space-y-2">
            {Object.entries(metrics.sentimentDistribution).map(([sentiment, count]) => (
              <div key={sentiment} className="flex items-center justify-between">
                <span className="text-sm capitalize">{sentiment}</span>
                <div className="flex items-center gap-2">
                  <Progress 
                    value={(count / (metrics.totalAnalyses * 3)) * 100} 
                    className="h-2 w-24" 
                  />
                  <span className="text-xs text-muted-foreground w-8 text-right">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border border-border rounded-lg">
          <h4 className="font-medium text-sm mb-3">Distribuição de Ideologias</h4>
          <div className="space-y-2">
            {Object.entries(metrics.ideologyDistribution).map(([ideology, count]) => (
              <div key={ideology} className="flex items-center justify-between">
                <span className="text-sm capitalize">{ideology}</span>
                <div className="flex items-center gap-2">
                  <Progress 
                    value={(count / (metrics.totalAnalyses * 3)) * 100} 
                    className="h-2 w-24" 
                  />
                  <span className="text-xs text-muted-foreground w-8 text-right">
                    {count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Divergences Alert */}
      {metrics.divergences.length > 0 && (
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>{metrics.divergences.length} divergências</strong> detectadas que podem requerer revisão manual
          </AlertDescription>
        </Alert>
      )}

      {/* Divergences List */}
      {metrics.divergences.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Divergências Significativas (Top 10)
          </h4>
          <Accordion type="single" collapsible className="w-full">
            {metrics.divergences.map((divergence, idx) => (
              <AccordionItem key={divergence.analysisId} value={`item-${idx}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{divergence.candidateName}</span>
                      <Badge variant="outline" className="text-xs">
                        {divergence.date}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {divergence.sentimentDivergence && (
                        <Badge variant="destructive" className="text-xs">
                          Sentimento
                        </Badge>
                      )}
                      {divergence.ideologyDivergence && (
                        <Badge variant="destructive" className="text-xs">
                          Ideologia
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    {/* Gemini Flash */}
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium text-xs mb-2 text-muted-foreground">
                        Gemini Flash
                      </p>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">Sentimento:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.geminiFlash?.sentiment || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Ideologia:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.geminiFlash?.ideology || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Score:</span>{" "}
                          {divergence.models.geminiFlash?.sentimentScore || "N/A"}
                        </p>
                      </div>
                    </div>

                    {/* Gemini Pro */}
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium text-xs mb-2 text-muted-foreground">
                        Gemini Pro
                      </p>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">Sentimento:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.geminiPro?.sentiment || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Ideologia:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.geminiPro?.ideology || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Score:</span>{" "}
                          {divergence.models.geminiPro?.sentimentScore || "N/A"}
                        </p>
                      </div>
                    </div>

                    {/* GPT-5 Mini */}
                    <div className="p-3 bg-muted/50 rounded-lg">
                      <p className="font-medium text-xs mb-2 text-muted-foreground">
                        GPT-5 Mini
                      </p>
                      <div className="space-y-1">
                        <p className="text-sm">
                          <span className="font-medium">Sentimento:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.gpt5Mini?.sentiment || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Ideologia:</span>{" "}
                          <Badge variant="outline" className="ml-1">
                            {divergence.models.gpt5Mini?.ideology || "N/A"}
                          </Badge>
                        </p>
                        <p className="text-sm">
                          <span className="font-medium">Score:</span>{" "}
                          {divergence.models.gpt5Mini?.sentimentScore || "N/A"}
                        </p>
                      </div>
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      )}

      {metrics.divergences.length === 0 && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-2 text-success" />
          <p className="font-medium">Excelente Concordância!</p>
          <p className="text-sm">Nenhuma divergência significativa detectada</p>
        </div>
      )}
    </Card>
  );
}
