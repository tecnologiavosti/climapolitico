import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MapPin, Users, Database, BarChart3 } from "lucide-react";

interface SourceData {
  social_network: string;
  profile_count: number;
  state?: string;
  total_interactions: number;
  data_quality: number;
}

interface AnalysisSourceMetadataProps {
  sources: SourceData[];
  geographicScope: string;
  totalProfiles: number;
  uniqueProfiles: number;
}

export function AnalysisSourceMetadata({
  sources,
  geographicScope,
  totalProfiles,
  uniqueProfiles
}: AnalysisSourceMetadataProps) {
  const formatGeographicScope = (scope: string) => {
    if (scope === 'nacional') return '🇧🇷 Nacional';
    return `📍 ${scope.replace('regional_', '').replace(/_/g, ' ')}`;
  };

  return (
    <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-800">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Database className="w-5 h-5 text-blue-600" />
          Rastreabilidade dos Dados
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Escopo Geográfico */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Escopo Geográfico:</span>
          </div>
          <Badge variant={geographicScope === 'nacional' ? 'default' : 'secondary'}>
            {formatGeographicScope(geographicScope)}
          </Badge>
        </div>

        {/* Perfis Analisados */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Perfis Analisados:</span>
          </div>
          <div className="text-sm">
            <strong>{totalProfiles}</strong> total
            {uniqueProfiles < totalProfiles && (
              <span className="text-muted-foreground ml-1">
                ({uniqueProfiles} únicos)
              </span>
            )}
          </div>
        </div>

        {/* Redes Sociais */}
        {sources && sources.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Fontes de Dados:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {sources.map((source, index) => (
                <Badge key={index} variant="outline" className="text-xs">
                  {source.social_network}: {source.profile_count} perfil(is)
                  {source.state && ` • ${source.state}`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Qualidade dos Dados */}
        <div className="pt-2 border-t">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Confiabilidade dos Dados:</span>
            <span className="font-medium">
              {sources[0]?.data_quality ? `${(sources[0].data_quality * 100).toFixed(0)}%` : 'N/A'}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
