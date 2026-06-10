import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Instagram, Twitter, Facebook, Youtube, Linkedin, Globe, MessageCircle } from "lucide-react";
import { SocialMediaReportData } from "@/pages/dashboard/SocialMediaReport";

interface SocialMediaTableProps {
  data: SocialMediaReportData[];
}

const networkIcons: Record<string, any> = {
  'Instagram': Instagram,
  'Twitter/X': Twitter,
  'Facebook': Facebook,
  'YouTube': Youtube,
  'LinkedIn': Linkedin,
  'TikTok': Globe,
  'Reddit': MessageCircle,
  'Outro': Globe
};

const sentimentColors = {
  Positivo: "bg-green-500/20 text-green-700 border-green-500/30",
  Neutro: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  Negativo: "bg-red-500/20 text-red-700 border-red-500/30"
};

export function SocialMediaTable({ data }: SocialMediaTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Análise Detalhada por Rede Social</CardTitle>
        <CardDescription>
          Distribuição de menções, perfis e sentimentos em cada plataforma
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rede Social</TableHead>
                <TableHead className="text-right">Menções</TableHead>
                <TableHead className="text-right">Perfis</TableHead>
                <TableHead className="text-right">Interações</TableHead>
                <TableHead className="text-center">Positivo</TableHead>
                <TableHead className="text-center">Neutro</TableHead>
                <TableHead className="text-center">Negativo</TableHead>
                <TableHead>Dominância</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => {
                const Icon = networkIcons[row.network] || Globe;
                return (
                  <TableRow key={row.network}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        {row.network}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(row.totalMentions ?? 0).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(row.uniqueProfiles ?? 0).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(row.totalInteractions ?? 0).toLocaleString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={sentimentColors.Positivo}>
                        {row.positivePercent}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={sentimentColors.Neutro}>
                        {row.neutralPercent}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className={sentimentColors.Negativo}>
                        {row.negativePercent}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium min-w-16">
                            {row.dominantSentiment}
                          </span>
                          <Progress 
                            value={
                              row.dominantSentiment === "Positivo" ? row.positivePercent :
                              row.dominantSentiment === "Negativo" ? row.negativePercent :
                              row.neutralPercent
                            }
                            className="h-2"
                          />
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Totais */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm text-muted-foreground">Total de Redes</p>
              <p className="text-2xl font-bold">{data.length}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Perfis</p>
              <p className="text-2xl font-bold">
                {data.reduce((sum, item) => sum + item.uniqueProfiles, 0).toLocaleString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Menções</p>
              <p className="text-2xl font-bold">
                {data.reduce((sum, item) => sum + item.totalMentions, 0).toLocaleString('pt-BR')}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total de Interações</p>
              <p className="text-2xl font-bold">
                {data.reduce((sum, item) => sum + item.totalInteractions, 0).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
