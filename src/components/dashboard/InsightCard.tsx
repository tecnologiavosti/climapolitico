import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, TrendingUp, TrendingDown, Lightbulb, CheckCircle2, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

interface InsightCardProps {
  insight: {
    id: string;
    insight_type: string;
    priority: string;
    title: string;
    description: string;
    recommended_actions: string[];
    confidence_score: number;
    created_at: string;
    is_active: boolean;
    supporting_data?: any;
  };
}

export const InsightCard = ({ insight }: InsightCardProps) => {
  const queryClient = useQueryClient();
  const [isExpanded, setIsExpanded] = useState(false);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('ai_insights')
        .update({ is_active: false, dismissed_at: new Date().toISOString() })
        .eq('id', insight.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-insights'] });
      toast.success('Insight descartado');
    },
    onError: () => {
      toast.error('Erro ao descartar insight');
    }
  });

  const getTypeIcon = () => {
    switch (insight.insight_type) {
      case 'crisis': return <AlertTriangle className="h-4 w-4" />;
      case 'opportunity': return <TrendingUp className="h-4 w-4" />;
      case 'trend': return <TrendingDown className="h-4 w-4" />;
      case 'recommendation': return <Lightbulb className="h-4 w-4" />;
      default: return null;
    }
  };

  const getTypeLabel = () => {
    switch (insight.insight_type) {
      case 'crisis': return 'Crise';
      case 'opportunity': return 'Oportunidade';
      case 'trend': return 'Tendência';
      case 'recommendation': return 'Recomendação';
      default: return insight.insight_type;
    }
  };

  const getTypeColor = () => {
    switch (insight.insight_type) {
      case 'crisis': return 'destructive';
      case 'opportunity': return 'default';
      case 'trend': return 'secondary';
      case 'recommendation': return 'outline';
      default: return 'default';
    }
  };

  const getPriorityColor = () => {
    switch (insight.priority) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'default';
    }
  };

  const getPriorityLabel = () => {
    switch (insight.priority) {
      case 'high': return 'Alta';
      case 'medium': return 'Média';
      case 'low': return 'Baixa';
      default: return insight.priority;
    }
  };

  return (
    <Card className={!insight.is_active ? 'opacity-50' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant={getTypeColor()} className="gap-1">
                {getTypeIcon()}
                {getTypeLabel()}
              </Badge>
              <Badge variant={getPriorityColor()}>
                {getPriorityLabel()}
              </Badge>
              <Badge variant="outline">
                {insight.confidence_score}% confiança
              </Badge>
            </div>
            <CardTitle className="text-xl">{insight.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {new Date(insight.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </p>
          </div>
          {insight.is_active && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-foreground leading-relaxed">{insight.description}</p>

        {insight.recommended_actions && insight.recommended_actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              Ações Recomendadas
            </h4>
            <ul className="space-y-1.5 ml-6">
              {insight.recommended_actions.map((action, index) => (
                <li key={index} className="text-sm text-foreground list-disc">
                  {action}
                </li>
              ))}
            </ul>
          </div>
        )}

        {insight.supporting_data && (
          <div className="pt-2 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="w-full justify-between"
            >
              <span className="text-sm font-medium">Dados de Suporte</span>
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            {isExpanded && (
              <div className="mt-2 p-3 bg-muted rounded-lg">
                <pre className="text-xs overflow-auto max-h-48">
                  {JSON.stringify(insight.supporting_data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};