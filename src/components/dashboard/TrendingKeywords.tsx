import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";

export const TrendingKeywords = () => {
  const { data: keywords } = useQuery({
    queryKey: ['trending-keywords'],
    queryFn: async () => {
      // Buscar análises dos últimos 7 dias
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error } = await supabase
        .from('candidate_analyses')
        .select('keywords')
        .gte('created_at', sevenDaysAgo.toISOString());

      if (error) throw error;

      // Contar frequência de cada palavra-chave
      const keywordCount: Record<string, number> = {};
      data?.forEach(analysis => {
        if (analysis.keywords && Array.isArray(analysis.keywords)) {
          analysis.keywords.forEach(keyword => {
            keywordCount[keyword] = (keywordCount[keyword] || 0) + 1;
          });
        }
      });

      // Ordenar por frequência e pegar top 20
      return Object.entries(keywordCount)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([keyword, count]) => ({ keyword, count }));
    }
  });

  if (!keywords || keywords.length === 0) return null;

  const maxCount = Math.max(...keywords.map(k => k.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Palavras-Chave em Alta
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {keywords.map(({ keyword, count }) => {
            const size = Math.max(0.8, (count / maxCount) * 1.5);
            return (
              <Badge
                key={keyword}
                variant="outline"
                className="cursor-default"
                style={{
                  fontSize: `${size}rem`,
                  padding: `${size * 0.25}rem ${size * 0.5}rem`
                }}
              >
                {keyword} ({count})
              </Badge>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};