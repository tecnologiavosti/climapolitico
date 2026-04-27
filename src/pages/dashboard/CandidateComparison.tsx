import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, MessageSquare, Heart, TrendingUp } from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";

type SortKey = "mentions" | "sentiment" | "engagement" | "authors";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "mentions", label: "Menções" },
  { value: "sentiment", label: "Sentimento" },
  { value: "engagement", label: "Engajamento" },
  { value: "authors", label: "Autores Únicos" },
];

interface CandidateComparison {
  id: string;
  name: string;
  party: string | null;
  mentions: number;
  authors: number;
  engagement: number;
  sentiment: number | null;
  positive: number;
  negative: number;
  neutral: number;
}

const Bar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="w-full bg-muted rounded-full h-5 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
};

const SentimentBar = ({ positive, negative, neutral }: { positive: number; negative: number; neutral: number }) => {
  const total = positive + negative + neutral;
  if (total === 0) return <div className="text-xs text-muted-foreground">Sem dados</div>;
  const pPos = (positive / total) * 100;
  const pNeu = (neutral / total) * 100;
  const pNeg = (negative / total) * 100;
  return (
    <div className="w-full h-5 rounded-full overflow-hidden flex">
      <div className="bg-green-500 h-full transition-all" style={{ width: `${pPos}%` }} />
      <div className="bg-yellow-400 h-full transition-all" style={{ width: `${pNeu}%` }} />
      <div className="bg-red-500 h-full transition-all" style={{ width: `${pNeg}%` }} />
    </div>
  );
};

const CandidateComparisonPage = () => {
  const { user } = useAuth();
  const [sortBy, setSortBy] = useState<SortKey>("mentions");

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidate-comparison', user?.id],
    queryFn: async () => {
      // Fetch candidates
      const { data: cands, error: candErr } = await supabase
        .from('candidates')
        .select('id, full_name, party')
        .order('full_name');
      if (candErr) throw candErr;
      if (!cands || cands.length === 0) return [];

      // Fetch metrics cache
      const { data: metrics, error: metErr } = await supabase
        .from('candidate_metrics_cache')
        .select('candidate_id, total_mentions, unique_authors, total_engagement, average_sentiment, positive_count, negative_count, neutral_count');
      if (metErr) throw metErr;

      const metricsMap = new Map(metrics?.map(m => [m.candidate_id, m]) || []);

      return cands.map((c): CandidateComparison => {
        const m = metricsMap.get(c.id);
        return {
          id: c.id,
          name: c.full_name,
          party: c.party,
          mentions: m?.total_mentions || 0,
          authors: m?.unique_authors || 0,
          engagement: m?.total_engagement || 0,
          sentiment: m?.average_sentiment != null ? Number(m.average_sentiment) : null,
          positive: m?.positive_count || 0,
          negative: m?.negative_count || 0,
          neutral: m?.neutral_count || 0,
        };
      });
    },
    enabled: !!user,
  });

  const sorted = [...candidates].sort((a, b) => {
    switch (sortBy) {
      case "mentions": return b.mentions - a.mentions;
      case "sentiment": return (b.sentiment ?? 0) - (a.sentiment ?? 0);
      case "engagement": return b.engagement - a.engagement;
      case "authors": return b.authors - a.authors;
      default: return 0;
    }
  });

  const maxMentions = Math.max(...candidates.map(c => c.mentions), 1);
  const maxEngagement = Math.max(...candidates.map(c => c.engagement), 1);
  const maxAuthors = Math.max(...candidates.map(c => c.authors), 1);

  const getSentimentLabel = (val: number | null) => {
    if (val == null) return { text: "N/A", class: "text-muted-foreground" };
    if (val >= 60) return { text: "Positivo", class: "text-green-600 dark:text-green-400" };
    if (val >= 40) return { text: "Neutro", class: "text-yellow-600 dark:text-yellow-400" };
    return { text: "Negativo", class: "text-red-600 dark:text-red-400" };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Comparação de Candidatos</h1>
          <p className="text-muted-foreground mt-1">Visualização comparativa rápida baseada em dados reais.</p>
        </div>
        <HelpTooltip text="Define o critério usado para ordenar os candidatos na comparação (menções, sentimento, etc.).">
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Ordenar por" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map(o => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </HelpTooltip>
      </div>

      {isLoading && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Carregando...</CardContent></Card>
      )}

      {!isLoading && sorted.length === 0 && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Nenhum candidato cadastrado.</CardContent></Card>
      )}

      {!isLoading && sorted.length > 0 && (
        <>
          {/* Metric Comparison Cards */}
          {[
            { key: "mentions" as const, title: "Menções", icon: MessageSquare, max: maxMentions, color: "bg-primary", getValue: (c: CandidateComparison) => c.mentions },
            { key: "authors" as const, title: "Autores Únicos", icon: Users, max: maxAuthors, color: "bg-blue-500", getValue: (c: CandidateComparison) => c.authors },
            { key: "engagement" as const, title: "Engajamento Total", icon: Heart, max: maxEngagement, color: "bg-pink-500", getValue: (c: CandidateComparison) => c.engagement },
          ].map(metric => {
            const metricSorted = [...candidates].sort((a, b) => metric.getValue(b) - metric.getValue(a));
            return (
              <Card key={metric.key}>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <metric.icon className="h-5 w-5" />
                    {metric.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {metricSorted.map((c, i) => (
                      <div key={c.id} className="flex items-center gap-3">
                        <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}.</span>
                        <div className="w-32 sm:w-48 truncate text-sm font-medium">
                          {c.name}
                          {c.party && <span className="text-muted-foreground ml-1 text-xs">({c.party})</span>}
                        </div>
                        <div className="flex-1">
                          <Bar value={metric.getValue(c)} max={metric.max} color={metric.color} />
                        </div>
                        <span className="text-sm font-bold w-16 text-right">{metric.getValue(c).toLocaleString('pt-BR')}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}

          {/* Sentiment Comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <TrendingUp className="h-5 w-5" />
                Sentimento
              </CardTitle>
              <CardDescription className="flex gap-4 mt-1">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Positivo</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 inline-block" /> Neutro</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500 inline-block" /> Negativo</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[...candidates].sort((a, b) => (b.sentiment ?? 0) - (a.sentiment ?? 0)).map((c, i) => {
                  const label = getSentimentLabel(c.sentiment);
                  return (
                    <div key={c.id} className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground w-5">{i + 1}.</span>
                      <div className="w-32 sm:w-48 truncate text-sm font-medium">
                        {c.name}
                        {c.party && <span className="text-muted-foreground ml-1 text-xs">({c.party})</span>}
                      </div>
                      <div className="flex-1">
                        <SentimentBar positive={c.positive} negative={c.negative} neutral={c.neutral} />
                      </div>
                      <div className="w-20 text-right">
                        <span className={`text-sm font-bold ${label.class}`}>
                          {c.sentiment != null ? `${c.sentiment.toFixed(0)}%` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Resumo Geral</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-2 font-medium">#</th>
                      <th className="text-left py-2 px-2 font-medium">Candidato</th>
                      <th className="text-right py-2 px-2 font-medium">Menções</th>
                      <th className="text-right py-2 px-2 font-medium">Autores</th>
                      <th className="text-right py-2 px-2 font-medium">Engajamento</th>
                      <th className="text-right py-2 px-2 font-medium">Sentimento</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((c, i) => {
                      const label = getSentimentLabel(c.sentiment);
                      return (
                        <tr key={c.id} className="border-b last:border-0">
                          <td className="py-2 px-2 text-muted-foreground">{i + 1}</td>
                          <td className="py-2 px-2 font-medium">
                            {c.name}
                            {c.party && <Badge variant="outline" className="ml-2 text-xs">{c.party}</Badge>}
                          </td>
                          <td className="py-2 px-2 text-right">{c.mentions.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right">{c.authors.toLocaleString('pt-BR')}</td>
                          <td className="py-2 px-2 text-right">{c.engagement.toLocaleString('pt-BR')}</td>
                          <td className={`py-2 px-2 text-right font-bold ${label.class}`}>
                            {c.sentiment != null ? `${c.sentiment.toFixed(0)}%` : 'N/A'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};

export default CandidateComparisonPage;
