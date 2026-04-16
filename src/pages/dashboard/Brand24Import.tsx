import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Globe, Twitter, Facebook, Instagram, Youtube, MessageSquare } from "lucide-react";

interface ParsedMention {
  date: string;
  author: string;
  authorUrl?: string;
  source: string;
  sourceType: string;
  content: string;
  sentiment?: string;
  reach?: number;
  interactions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  url?: string;
}

interface ImportResult {
  success: boolean;
  imported: number;
  networks: Record<string, number>;
  sentiment: { positive: number; negative: number; neutral: number; none: number };
  ai_analyzed: number;
}

const networkIcons: Record<string, React.ReactNode> = {
  twitter: <Twitter className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
  instagram: <Instagram className="h-4 w-4" />,
  youtube: <Youtube className="h-4 w-4" />,
  news: <Globe className="h-4 w-4" />,
  forum: <MessageSquare className="h-4 w-4" />,
};

const networkLabels: Record<string, string> = {
  twitter: "Twitter/X",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  news: "Notícias/Blogs",
  forum: "Fóruns",
  other: "Outros",
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  
  // Parse header - handle quoted fields
  const parseRow = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if ((ch === ',' || ch === ';') && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/[""]/g, ''));
  return lines.slice(1).map(line => {
    const values = parseRow(line);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] || ''; });
    return obj;
  });
}

function mapBrand24Row(row: Record<string, string>): ParsedMention | null {
  // Brand24 CSV columns vary by export language. Support common variants.
  const content = row['content'] || row['conteúdo'] || row['text'] || row['texto'] || row['mention content'] || row['mention'] || '';
  if (!content.trim()) return null;

  const date = row['date'] || row['data'] || row['created'] || row['published'] || '';
  const author = row['author'] || row['autor'] || row['author name'] || row['nome do autor'] || '';
  const source = row['source'] || row['fonte'] || row['domain'] || row['domínio'] || row['source title'] || '';
  const sourceType = row['source type'] || row['tipo de fonte'] || row['type'] || row['tipo'] || '';
  const sentiment = row['sentiment'] || row['sentimento'] || '';
  const reach = parseInt(row['reach'] || row['alcance'] || '0') || 0;
  const interactions = parseInt(row['interactions'] || row['interações'] || row['engagement'] || '0') || 0;
  const likes = parseInt(row['likes'] || row['curtidas'] || '0') || 0;
  const comments = parseInt(row['comments'] || row['comentários'] || row['replies'] || '0') || 0;
  const shares = parseInt(row['shares'] || row['compartilhamentos'] || row['retweets'] || '0') || 0;
  const url = row['url'] || row['link'] || row['mention url'] || '';
  const authorUrl = row['author url'] || row['url do autor'] || row['profile url'] || '';

  return {
    date, author, authorUrl: authorUrl || undefined, source, sourceType,
    content, sentiment: sentiment || undefined, reach, interactions,
    likes, comments, shares, url: url || undefined,
  };
}

export default function Brand24Import() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [candidateId, setCandidateId] = useState("");
  const [parsedMentions, setParsedMentions] = useState<ParsedMention[]>([]);
  const [fileName, setFileName] = useState("");
  const [reanalyzeSentiment, setReanalyzeSentiment] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ImportResult | null>(null);

  const { data: candidates } = useQuery({
    queryKey: ['candidates-list', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('candidates')
        .select('id, full_name, party')
        .order('full_name');
      return data || [];
    },
    enabled: !!user,
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResult(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);
      const mentions = rows.map(mapBrand24Row).filter(Boolean) as ParsedMention[];
      setParsedMentions(mentions);

      if (mentions.length === 0) {
        toast({
          title: "Nenhuma menção encontrada",
          description: "O arquivo CSV não contém dados válidos. Verifique o formato de exportação do Brand24.",
          variant: "destructive",
        });
      } else {
        toast({
          title: `${mentions.length} menções encontradas`,
          description: `Arquivo "${file.name}" processado com sucesso.`,
        });
      }
    };
    reader.readAsText(file, 'utf-8');
  }, [toast]);

  const handleImport = async () => {
    if (!candidateId || parsedMentions.length === 0) return;

    setImporting(true);
    setProgress(10);
    setResult(null);

    try {
      // Send in batches of 100
      const batchSize = 100;
      let totalImported = 0;
      const allNetworks: Record<string, number> = {};
      const allSentiment = { positive: 0, negative: 0, neutral: 0, none: 0 };
      let totalAiAnalyzed = 0;

      for (let i = 0; i < parsedMentions.length; i += batchSize) {
        const batch = parsedMentions.slice(i, i + batchSize);
        const pct = Math.round(((i + batch.length) / parsedMentions.length) * 90) + 10;
        setProgress(pct);

        const { data, error } = await supabase.functions.invoke('import-brand24', {
          body: {
            mentions: batch,
            candidate_id: candidateId,
            reanalyze_sentiment: reanalyzeSentiment,
          },
        });

        if (error) throw error;
        if (!data.success) throw new Error(data.error || 'Erro na importação');

        totalImported += data.imported;
        totalAiAnalyzed += data.ai_analyzed || 0;
        Object.entries(data.networks as Record<string, number>).forEach(([k, v]) => {
          allNetworks[k] = (allNetworks[k] || 0) + v;
        });
        allSentiment.positive += data.sentiment.positive;
        allSentiment.negative += data.sentiment.negative;
        allSentiment.neutral += data.sentiment.neutral;
        allSentiment.none += data.sentiment.none;
      }

      setProgress(100);
      setResult({
        success: true,
        imported: totalImported,
        networks: allNetworks,
        sentiment: allSentiment,
        ai_analyzed: totalAiAnalyzed,
      });

      toast({
        title: "Importação concluída!",
        description: `${totalImported} menções importadas de ${Object.keys(allNetworks).length} redes.`,
      });
    } catch (error: any) {
      console.error('Import error:', error);
      toast({
        title: "Erro na importação",
        description: error.message || "Erro desconhecido",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  // Preview network distribution
  const previewNetworks: Record<string, number> = {};
  parsedMentions.forEach(m => {
    const s = (m.source || '').toLowerCase();
    const t = (m.sourceType || '').toLowerCase();
    let net = 'other';
    if (s.includes('twitter') || s.includes('x.com') || t.includes('twitter')) net = 'twitter';
    else if (s.includes('facebook') || t.includes('facebook')) net = 'facebook';
    else if (s.includes('instagram') || t.includes('instagram')) net = 'instagram';
    else if (s.includes('youtube') || t.includes('youtube')) net = 'youtube';
    else if (s.includes('tiktok') || t.includes('tiktok')) net = 'tiktok';
    else if (s.includes('reddit') || t.includes('reddit')) net = 'reddit';
    else if (s.includes('linkedin') || t.includes('linkedin')) net = 'linkedin';
    else if (t.includes('news') || t.includes('blog') || t.includes('web')) net = 'news';
    else if (t.includes('forum')) net = 'forum';
    previewNetworks[net] = (previewNetworks[net] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold">Importar Brand24</h2>
        <p className="text-muted-foreground mt-1">
          Importe menções exportadas do Brand24 (CSV) para alimentar o dashboard com dados reais de múltiplas redes sociais.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upload Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Upload do CSV
            </CardTitle>
            <CardDescription>
              Exporte suas menções do Brand24 como CSV e faça upload aqui.
              O sistema reconhece automaticamente as colunas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Candidato</Label>
              <Select value={candidateId} onValueChange={setCandidateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o candidato..." />
                </SelectTrigger>
                <SelectContent>
                  {candidates?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name} {c.party ? `(${c.party})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Arquivo CSV do Brand24</Label>
              <div className="mt-2">
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
                  <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">
                    {fileName || "Clique para selecionar o CSV"}
                  </span>
                  <input
                    type="file"
                    accept=".csv,.txt"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                </label>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                checked={reanalyzeSentiment}
                onCheckedChange={setReanalyzeSentiment}
                id="reanalyze"
              />
              <Label htmlFor="reanalyze">
                Reanalisar sentimento com IA (recomendado para contexto político)
              </Label>
            </div>

            {importing && (
              <div className="space-y-2">
                <Progress value={progress} />
                <p className="text-sm text-muted-foreground text-center">
                  Importando... {progress}%
                </p>
              </div>
            )}

            <Button
              onClick={handleImport}
              disabled={!candidateId || parsedMentions.length === 0 || importing}
              className="w-full"
              size="lg"
            >
              {importing ? "Importando..." : `Importar ${parsedMentions.length} menções`}
            </Button>
          </CardContent>
        </Card>

        {/* Preview / Result Card */}
        <Card>
          <CardHeader>
            <CardTitle>
              {result ? "Resultado da Importação" : "Prévia dos Dados"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span className="font-semibold">{result.imported} menções importadas</span>
                </div>

                {result.ai_analyzed > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {result.ai_analyzed} menções analisadas por IA
                  </p>
                )}

                <div>
                  <h4 className="font-medium mb-2">Redes coletadas:</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(result.networks).map(([net, count]) => (
                      <Badge key={net} variant="secondary" className="flex items-center gap-1">
                        {networkIcons[net] || <Globe className="h-3 w-3" />}
                        {networkLabels[net] || net}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Sentimento:</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge className="bg-green-100 text-green-800">
                      Positivo: {result.sentiment.positive}
                    </Badge>
                    <Badge className="bg-red-100 text-red-800">
                      Negativo: {result.sentiment.negative}
                    </Badge>
                    <Badge className="bg-gray-100 text-gray-800">
                      Neutro: {result.sentiment.neutral}
                    </Badge>
                    {result.sentiment.none > 0 && (
                      <Badge variant="outline">
                        Sem análise: {result.sentiment.none}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ) : parsedMentions.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-primary">
                  <FileSpreadsheet className="h-5 w-5" />
                  <span className="font-semibold">{parsedMentions.length} menções encontradas</span>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Redes detectadas:</h4>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(previewNetworks).map(([net, count]) => (
                      <Badge key={net} variant="outline" className="flex items-center gap-1">
                        {networkIcons[net] || <Globe className="h-3 w-3" />}
                        {networkLabels[net] || net}: {count}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium mb-2">Amostra (3 primeiras):</h4>
                  <div className="space-y-2">
                    {parsedMentions.slice(0, 3).map((m, i) => (
                      <div key={i} className="p-2 bg-muted rounded text-sm">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                          <span>{m.author || 'Anônimo'}</span>
                          <span>•</span>
                          <span>{m.source}</span>
                          {m.date && <><span>•</span><span>{m.date}</span></>}
                        </div>
                        <p className="line-clamp-2">{m.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mb-3 opacity-50" />
                <p className="text-center">
                  Faça upload de um CSV exportado do Brand24 para ver a prévia dos dados.
                </p>
                <p className="text-xs mt-2 text-center">
                  No Brand24: Mentions → Export → CSV
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Como exportar do Brand24</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ol className="list-decimal list-inside space-y-2">
            <li>Acesse seu projeto no <strong>Brand24</strong> e vá para a aba <strong>Mentions</strong></li>
            <li>Aplique os filtros desejados (data, rede social, sentimento)</li>
            <li>Clique em <strong>Export</strong> → <strong>CSV</strong></li>
            <li>Faça upload do arquivo aqui e selecione o candidato correspondente</li>
            <li>O sistema detecta automaticamente as redes: Twitter/X, Facebook, Instagram, YouTube, TikTok, Reddit, LinkedIn, Notícias, Blogs e Fóruns</li>
          </ol>
          <p className="mt-4 p-3 bg-muted rounded">
            💡 <strong>Dica:</strong> Ative "Reanalisar sentimento com IA" para obter uma análise calibrada para o contexto político brasileiro, mais precisa que o sentimento genérico do Brand24.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
