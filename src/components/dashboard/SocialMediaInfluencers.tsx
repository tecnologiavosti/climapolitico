import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { 
  Users, 
  TrendingUp, 
  MessageSquare, 
  Award,
  ExternalLink,
  Instagram,
  Twitter,
  Facebook,
  Youtube,
  Globe,
  MessageCircle
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { DateRange } from "react-day-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

interface SocialMediaInfluencersProps {
  selectedCandidate: string;
  dateRange: DateRange | undefined;
}

interface InfluencerData {
  profileId: string;
  username: string;
  totalMentions: number;
  totalFollowers: number;
  totalInteractions: number;
  engagementRate: number;
  networks: string[];
  sentiment: {
    positive: number;
    neutral: number;
    negative: number;
  };
  profileUrl?: string;
  location?: string;
}

const NETWORK_ICONS: Record<string, any> = {
  'Instagram': Instagram,
  'Twitter/X': Twitter,
  'Facebook': Facebook,
  'YouTube': Youtube,
  'Reddit': MessageCircle,
};

export const SocialMediaInfluencers = ({ 
  selectedCandidate, 
  dateRange 
}: SocialMediaInfluencersProps) => {
  const { user } = useAuth();
  const { isAdmin } = useAdminCheck();
  const [selectedNetwork, setSelectedNetwork] = useState<string>("all");
  const [minFollowers, setMinFollowers] = useState<number>(1000);

  const { data: influencerData, isLoading } = useQuery({
    queryKey: ['social-media-influencers', selectedCandidate, selectedNetwork, dateRange, isAdmin, minFollowers],
    queryFn: async () => {
      // Buscar análises no período
      let analysesQuery = supabase
        .from('candidate_analyses')
        .select('id, sentiment_label')
        .order('created_at', { ascending: false });

      if (!isAdmin && user) {
        analysesQuery = analysesQuery.eq('user_id', user.id);
      }

      if (selectedCandidate !== 'all') {
        analysesQuery = analysesQuery.eq('candidate_id', selectedCandidate);
      }

      if (dateRange?.from) {
        analysesQuery = analysesQuery.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        analysesQuery = analysesQuery.lte('created_at', dateRange.to.toISOString());
      }

      const { data: analyses, error: analysesError } = await analysesQuery;
      if (analysesError) throw analysesError;

      if (!analyses || analyses.length === 0) {
        return { networks: [], influencers: [], topInfluencers: [] };
      }

      // Buscar sources (perfis)
      const analysisIds = analyses.map(a => a.id);
      let sourcesQuery = supabase
        .from('analysis_sources')
        .select('*')
        .in('analysis_id', analysisIds);

      if (selectedNetwork !== 'all') {
        sourcesQuery = sourcesQuery.eq('social_network', selectedNetwork);
      }

      const { data: sources, error: sourcesError } = await sourcesQuery;
      if (sourcesError) throw sourcesError;

      // Criar mapa de análise -> sentimento
      const analysisSentimentMap: Record<string, string> = {};
      analyses.forEach(analysis => {
        analysisSentimentMap[analysis.id] = analysis.sentiment_label?.toLowerCase() || 'neutro';
      });

      // Agrupar por perfil
      const profileMap: Record<string, {
        username: string;
        mentions: number;
        followers: number;
        interactions: number;
        networks: Set<string>;
        sentiment: { positive: number; neutral: number; negative: number };
        profileUrl?: string;
        location?: string;
      }> = {};

      const networksSet = new Set<string>();

      sources?.forEach(source => {
        const profileId = source.profile_unique_id;
        const network = source.social_network || 'Outro';
        networksSet.add(network);

        if (!profileMap[profileId]) {
          profileMap[profileId] = {
            username: source.profile_username || 'Anônimo',
            mentions: 0,
            followers: source.followers_at_collection || 0,
            interactions: 0,
            networks: new Set(),
            sentiment: { positive: 0, neutral: 0, negative: 0 },
            profileUrl: source.profile_url || undefined,
            location: source.profile_location_state || source.profile_location_city || undefined,
          };
        }

        // Acumular dados
        const mentions = (source.posts_collected || 0) + (source.comments_collected || 0);
        profileMap[profileId].mentions += mentions;
        profileMap[profileId].interactions += source.interactions_count || 0;
        profileMap[profileId].networks.add(network);

        // Atualizar maior número de followers (caso tenha mudado ao longo do tempo)
        if (source.followers_at_collection && source.followers_at_collection > profileMap[profileId].followers) {
          profileMap[profileId].followers = source.followers_at_collection;
        }

        // Contar sentimento
        const sentiment = analysisSentimentMap[source.analysis_id];
        if (sentiment === 'positivo') {
          profileMap[profileId].sentiment.positive++;
        } else if (sentiment === 'negativo') {
          profileMap[profileId].sentiment.negative++;
        } else {
          profileMap[profileId].sentiment.neutral++;
        }
      });

      // Converter para array e calcular taxa de engajamento
      const influencers: InfluencerData[] = Object.entries(profileMap)
        .filter(([_, data]) => data.followers >= minFollowers) // Filtrar por mínimo de followers
        .map(([profileId, data]) => {
          const engagementRate = data.followers > 0 
            ? (data.interactions / data.followers) * 100 
            : 0;

          return {
            profileId,
            username: data.username,
            totalMentions: data.mentions,
            totalFollowers: data.followers,
            totalInteractions: data.interactions,
            engagementRate: parseFloat(engagementRate.toFixed(2)),
            networks: Array.from(data.networks),
            sentiment: data.sentiment,
            profileUrl: data.profileUrl,
            location: data.location,
          };
        })
        .sort((a, b) => b.totalFollowers - a.totalFollowers); // Ordenar por alcance (followers)

      const topInfluencers = influencers.slice(0, 50);

      return {
        networks: Array.from(networksSet).sort(),
        influencers,
        topInfluencers,
      };
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[400px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!influencerData || influencerData.influencers.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Análise de Influenciadores</CardTitle>
          <CardDescription>Perfis com maior alcance que mencionam o candidato</CardDescription>
        </CardHeader>
        <CardContent className="py-12 text-center">
          <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">
            Nenhum perfil influenciador encontrado no período selecionado
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Ajuste os filtros ou o mínimo de seguidores para ver resultados
          </p>
        </CardContent>
      </Card>
    );
  }

  const getDominantSentiment = (sentiment: InfluencerData['sentiment']) => {
    const total = sentiment.positive + sentiment.neutral + sentiment.negative;
    if (total === 0) return 'neutral';
    
    const positivePercent = (sentiment.positive / total) * 100;
    const negativePercent = (sentiment.negative / total) * 100;
    
    if (positivePercent > 50) return 'positive';
    if (negativePercent > 50) return 'negative';
    return 'neutral';
  };

  const topByEngagement = [...influencerData.topInfluencers]
    .sort((a, b) => b.engagementRate - a.engagementRate)
    .slice(0, 10);

  const topByReach = influencerData.topInfluencers.slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Análise de Perfis Influenciadores</h2>
        <p className="text-muted-foreground">
          Identifique os perfis com maior alcance e engajamento que mencionam o candidato
        </p>
      </div>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle>Filtros de Análise</CardTitle>
          <CardDescription>Personalize a identificação de influenciadores</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Rede Social</label>
              <Select value={selectedNetwork} onValueChange={setSelectedNetwork}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as redes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as redes sociais</SelectItem>
                  {influencerData.networks.map(network => (
                    <SelectItem key={network} value={network}>
                      {network}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Mínimo de Seguidores</label>
              <Select value={minFollowers.toString()} onValueChange={(v) => setMinFollowers(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sem mínimo</SelectItem>
                  <SelectItem value="1000">1.000+ seguidores</SelectItem>
                  <SelectItem value="5000">5.000+ seguidores</SelectItem>
                  <SelectItem value="10000">10.000+ seguidores</SelectItem>
                  <SelectItem value="50000">50.000+ seguidores</SelectItem>
                  <SelectItem value="100000">100.000+ seguidores</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top 3 Influenciadores */}
      <div className="grid gap-4 md:grid-cols-3">
        {influencerData.topInfluencers.slice(0, 3).map((influencer, index) => {
          const dominant = getDominantSentiment(influencer.sentiment);
          const icons = [Award, TrendingUp, Users];
          const Icon = icons[index] || Users;
          const medals = ['🥇', '🥈', '🥉'];

          return (
            <Card key={influencer.profileId} className="border-2 border-primary/20 hover:border-primary/40 transition-colors">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="h-12 w-12">
                      <AvatarFallback className="text-lg font-bold bg-primary text-primary-foreground">
                        {influencer.username.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="absolute -top-1 -right-1 text-2xl">{medals[index]}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{influencer.username}</CardTitle>
                    <CardDescription className="text-xs">
                      {Number(influencer.totalFollowers ?? 0).toLocaleString()} seguidores
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Menções</p>
                    <p className="font-bold">{influencer.totalMentions}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Engajamento</p>
                    <p className="font-bold">{influencer.engagementRate}%</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1">
                  {influencer.networks.map(network => {
                    const NetworkIcon = NETWORK_ICONS[network] || Globe;
                    return (
                      <Badge key={network} variant="secondary" className="text-xs">
                        <NetworkIcon className="h-3 w-3 mr-1" />
                        {network}
                      </Badge>
                    );
                  })}
                </div>

                <Badge 
                  variant={
                    dominant === 'positive' ? 'default' :
                    dominant === 'negative' ? 'destructive' : 'secondary'
                  }
                  className="w-full justify-center"
                >
                  {dominant === 'positive' ? 'Sentimento Positivo' :
                   dominant === 'negative' ? 'Sentimento Negativo' : 'Sentimento Neutro'}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Gráficos */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top 10 por Alcance */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 por Alcance (Seguidores)</CardTitle>
            <CardDescription>Perfis com maior número de seguidores</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                totalFollowers: {
                  label: "Seguidores",
                  color: "hsl(var(--primary))",
                },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topByReach} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    dataKey="username" 
                    type="category" 
                    width={80}
                    tick={{ fontSize: 11 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="totalFollowers" name="Seguidores" radius={[0, 4, 4, 0]}>
                    {topByReach.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={`hsl(var(--primary) / ${1 - (index * 0.08)})`}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Top 10 por Engajamento */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 por Taxa de Engajamento</CardTitle>
            <CardDescription>Perfis com melhor taxa de interação</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={{
                engagementRate: {
                  label: "Taxa de Engajamento",
                  color: "hsl(var(--chart-2))",
                },
              }}
              className="h-[350px]"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topByEngagement} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis 
                    dataKey="username" 
                    type="category" 
                    width={80}
                    tick={{ fontSize: 11 }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="engagementRate" name="Taxa %" radius={[0, 4, 4, 0]}>
                    {topByEngagement.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={`hsl(var(--chart-2) / ${1 - (index * 0.08)})`}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabela Detalhada */}
      <Card>
        <CardHeader>
          <CardTitle>Lista Completa de Influenciadores</CardTitle>
          <CardDescription>
            Análise detalhada de todos os perfis influenciadores identificados
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3 font-semibold">#</th>
                  <th className="text-left p-3 font-semibold">Perfil</th>
                  <th className="text-right p-3 font-semibold">Seguidores</th>
                  <th className="text-right p-3 font-semibold">Menções</th>
                  <th className="text-right p-3 font-semibold">Interações</th>
                  <th className="text-right p-3 font-semibold">Engajamento</th>
                  <th className="text-center p-3 font-semibold">Redes</th>
                  <th className="text-center p-3 font-semibold">Sentimento</th>
                  <th className="text-center p-3 font-semibold">Link</th>
                </tr>
              </thead>
              <tbody>
                {influencerData.topInfluencers.map((influencer, index) => {
                  const dominant = getDominantSentiment(influencer.sentiment);

                  return (
                    <tr key={influencer.profileId} className="border-b hover:bg-muted/50">
                      <td className="p-3 font-medium text-muted-foreground">
                        {index + 1}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="text-xs bg-primary/10">
                              {influencer.username.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold">{influencer.username}</p>
                            {influencer.location && (
                              <p className="text-xs text-muted-foreground">{influencer.location}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="text-right p-3 font-bold">
                        {Number(influencer.totalFollowers ?? 0).toLocaleString()}
                      </td>
                      <td className="text-right p-3">
                        {influencer.totalMentions}
                      </td>
                      <td className="text-right p-3">
                        {Number(influencer.totalInteractions ?? 0).toLocaleString()}
                      </td>
                      <td className="text-right p-3">
                        <Badge variant={influencer.engagementRate > 5 ? "default" : "secondary"}>
                          {influencer.engagementRate}%
                        </Badge>
                      </td>
                      <td className="p-3">
                        <div className="flex justify-center gap-1">
                          {influencer.networks.map(network => {
                            const NetworkIcon = NETWORK_ICONS[network] || Globe;
                            return (
                              <NetworkIcon key={network} className="h-4 w-4 text-muted-foreground" />
                            );
                          })}
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge 
                          variant={
                            dominant === 'positive' ? 'default' :
                            dominant === 'negative' ? 'destructive' : 'secondary'
                          }
                        >
                          {dominant === 'positive' ? '👍' : dominant === 'negative' ? '👎' : '😐'}
                        </Badge>
                      </td>
                      <td className="text-center p-3">
                        {influencer.profileUrl ? (
                          <a 
                            href={influencer.profileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            <ExternalLink className="h-4 w-4 inline" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Estatísticas */}
      <Card>
        <CardHeader>
          <CardTitle>Estatísticas de Influenciadores</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Total de Influenciadores</p>
              <p className="text-2xl font-bold">{influencerData.influencers.length}</p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Alcance Total</p>
              <p className="text-2xl font-bold">
                {influencerData.influencers
                  .reduce((sum, i) => sum + i.totalFollowers, 0)
                  .toLocaleString()}
              </p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Total de Interações</p>
              <p className="text-2xl font-bold">
                {influencerData.influencers
                  .reduce((sum, i) => sum + i.totalInteractions, 0)
                  .toLocaleString()}
              </p>
            </div>
            
            <div className="space-y-1 p-4 rounded-lg bg-muted/50">
              <p className="text-sm text-muted-foreground">Média de Engajamento</p>
              <p className="text-2xl font-bold">
                {(influencerData.influencers
                  .reduce((sum, i) => sum + i.engagementRate, 0) / 
                  influencerData.influencers.length || 0).toFixed(2)}%
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
