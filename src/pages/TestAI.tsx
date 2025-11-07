import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Brain, TrendingUp, AlertCircle } from "lucide-react";

interface AnalysisResult {
  sentiment?: string;
  ideology?: string;
  confidence: number;
  keywords?: string[];
  indicators?: string[];
  reasoning: string;
}

const TestAI = () => {
  const { toast } = useToast();
  const [texts, setTexts] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [analysisType, setAnalysisType] = useState<"sentiment" | "ideology">("sentiment");

  const sampleTexts = {
    sentiment: `O governo está fazendo um excelente trabalho na economia!
Estou muito preocupado com a situação atual do país
A nova proposta parece equilibrada e bem pensada`,
    ideology: `Precisamos de mais investimento em políticas sociais e distribuição de renda
A livre iniciativa e menor intervenção do estado são fundamentais
Devemos buscar o equilíbrio entre mercado e proteção social`
  };

  const handleAnalyze = async () => {
    if (!texts.trim()) {
      toast({
        title: "Campo vazio",
        description: "Por favor, insira textos para análise",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResults([]);

    try {
      const textArray = texts
        .split("\n")
        .filter((t) => t.trim().length > 0)
        .map((t) => t.trim());

      if (textArray.length === 0) {
        throw new Error("Nenhum texto válido para análise");
      }

      console.log("Analyzing texts:", textArray.length, "type:", analysisType);

      const { data, error } = await supabase.functions.invoke("analyze-sentiment", {
        body: { 
          texts: textArray,
          analysisType: analysisType
        },
      });

      if (error) {
        console.error("Function error:", error);
        throw error;
      }

      console.log("Analysis response:", data);

      if (data.error) {
        throw new Error(data.error);
      }

      if (!data.results || !Array.isArray(data.results)) {
        throw new Error("Resposta inválida da IA");
      }

      setResults(data.results);
      
      toast({
        title: "Análise concluída!",
        description: `${data.processedCount} texto(s) analisado(s) com sucesso`,
      });
    } catch (error) {
      console.error("Analysis error:", error);
      toast({
        title: "Erro na análise",
        description: error instanceof Error ? error.message : "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSample = () => {
    setTexts(sampleTexts[analysisType]);
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case "positive":
        return "bg-success text-success-foreground";
      case "negative":
        return "bg-destructive text-destructive-foreground";
      case "neutral":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getIdeologyColor = (ideology: string) => {
    switch (ideology) {
      case "left":
        return "bg-destructive text-destructive-foreground";
      case "right":
        return "bg-primary text-primary-foreground";
      case "center":
        return "bg-warning text-warning-foreground";
      case "neutral":
        return "bg-muted text-muted-foreground";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getSentimentLabel = (sentiment: string) => {
    const labels: Record<string, string> = {
      positive: "Positivo",
      negative: "Negativo",
      neutral: "Neutro",
    };
    return labels[sentiment] || sentiment;
  };

  const getIdeologyLabel = (ideology: string) => {
    const labels: Record<string, string> = {
      left: "Esquerda",
      right: "Direita",
      center: "Centro",
      neutral: "Neutro",
    };
    return labels[ideology] || ideology;
  };

  return (
    <div className="min-h-screen bg-gradient-secondary py-8">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="p-3 bg-gradient-primary rounded-lg">
                <Brain className="h-8 w-8 text-white" />
              </div>
            </div>
            <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              Teste de Análise com IA
            </h1>
            <p className="text-muted-foreground text-lg">
              Powered by Lovable AI • Google Gemini 2.5 Flash
            </p>
          </div>

          {/* Analysis Type Tabs */}
          <Tabs defaultValue="sentiment" onValueChange={(v) => setAnalysisType(v as "sentiment" | "ideology")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="sentiment">Análise de Sentimento</TabsTrigger>
              <TabsTrigger value="ideology">Classificação Ideológica</TabsTrigger>
            </TabsList>

            <TabsContent value="sentiment" className="space-y-4">
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Textos para Análise</h3>
                    <Button variant="outline" size="sm" onClick={loadSample}>
                      Carregar Exemplo
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Digite um texto por linha para analisar o sentimento..."
                    className="min-h-[200px]"
                    value={texts}
                    onChange={(e) => setTexts(e.target.value)}
                  />
                  <Button
                    onClick={handleAnalyze}
                    disabled={loading}
                    className="w-full bg-gradient-primary"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analisando...
                      </>
                    ) : (
                      <>
                        <TrendingUp className="mr-2 h-4 w-4" />
                        Analisar Sentimento
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </TabsContent>

            <TabsContent value="ideology" className="space-y-4">
              <Card className="p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Textos para Análise</h3>
                    <Button variant="outline" size="sm" onClick={loadSample}>
                      Carregar Exemplo
                    </Button>
                  </div>
                  <Textarea
                    placeholder="Digite um texto por linha para detectar a tendência política..."
                    className="min-h-[200px]"
                    value={texts}
                    onChange={(e) => setTexts(e.target.value)}
                  />
                  <Button
                    onClick={handleAnalyze}
                    disabled={loading}
                    className="w-full bg-gradient-primary"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analisando...
                      </>
                    ) : (
                      <>
                        <Brain className="mr-2 h-4 w-4" />
                        Detectar Ideologia
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Results */}
          {results.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-2xl font-bold">Resultados</h3>
              <div className="grid gap-4">
                {results.map((result, index) => (
                  <Card key={index} className="p-6">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="text-sm text-muted-foreground mb-2">
                            Texto #{index + 1}
                          </p>
                          <p className="font-medium mb-3">
                            {texts.split("\n").filter(t => t.trim())[index]}
                          </p>
                        </div>
                        <div className="text-right space-y-2">
                          {analysisType === "sentiment" && result.sentiment && (
                            <Badge className={getSentimentColor(result.sentiment)}>
                              {getSentimentLabel(result.sentiment)}
                            </Badge>
                          )}
                          {analysisType === "ideology" && result.ideology && (
                            <Badge className={getIdeologyColor(result.ideology)}>
                              {getIdeologyLabel(result.ideology)}
                            </Badge>
                          )}
                          <div className="text-sm text-muted-foreground">
                            Confiança: {Math.round(result.confidence * 100)}%
                          </div>
                        </div>
                      </div>

                      {result.reasoning && (
                        <div className="flex items-start gap-2 p-3 bg-muted rounded-lg">
                          <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <p className="text-sm text-muted-foreground">
                            {result.reasoning}
                          </p>
                        </div>
                      )}

                      {result.keywords && result.keywords.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-sm text-muted-foreground">Palavras-chave:</span>
                          {result.keywords.map((keyword, i) => (
                            <Badge key={i} variant="outline">
                              {keyword}
                            </Badge>
                          ))}
                        </div>
                      )}

                      {result.indicators && result.indicators.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          <span className="text-sm text-muted-foreground">Indicadores:</span>
                          {result.indicators.map((indicator, i) => (
                            <Badge key={i} variant="outline">
                              {indicator}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default TestAI;
