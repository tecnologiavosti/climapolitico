import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  CheckCircle2,
  XCircle,
  MessageSquare,
  Activity,
  Check,
  Instagram,
  Youtube,
  Facebook,
  Twitter,
  Music2,
  MapPinned,
} from "lucide-react";

// ===================== Tipos =====================
type Network = "instagram" | "tiktok" | "twitter" | "facebook" | "youtube";
type Region = "norte" | "nordeste" | "centro-oeste" | "sudeste" | "sul";

interface RegionalData {
  acceptance: number;
  rejection: number;
  mentions: number;
  engagement: number;
  topNetwork: Network;
  strengths: string[];
  recommendations: string[];
  comments: {
    name: string;
    city: string;
    date: string;
    text: string;
    sentiment: "positivo" | "negativo" | "neutro";
  }[];
}

// ===================== Constantes =====================
const NETWORKS: { value: Network; label: string; Icon: typeof Instagram }[] = [
  { value: "instagram", label: "Instagram", Icon: Instagram },
  { value: "tiktok", label: "TikTok", Icon: Music2 },
  { value: "twitter", label: "Twitter/X", Icon: Twitter },
  { value: "facebook", label: "Facebook", Icon: Facebook },
  { value: "youtube", label: "YouTube", Icon: Youtube },
];

const REGIONS: { value: Region; label: string }[] = [
  { value: "norte", label: "Norte" },
  { value: "nordeste", label: "Nordeste" },
  { value: "centro-oeste", label: "Centro-Oeste" },
  { value: "sudeste", label: "Sudeste" },
  { value: "sul", label: "Sul" },
];

const REGION_CITIES: Record<Region, string[]> = {
  norte: ["Manaus, AM", "Belém, PA", "Porto Velho, RO", "Rio Branco, AC", "Boa Vista, RR", "Macapá, AP"],
  nordeste: ["Salvador, BA", "Recife, PE", "Fortaleza, CE", "São Luís, MA", "Natal, RN", "Maceió, AL"],
  "centro-oeste": ["Goiânia, GO", "Brasília, DF", "Cuiabá, MT", "Campo Grande, MS", "Anápolis, GO", "Rondonópolis, MT"],
  sudeste: ["São Paulo, SP", "Rio de Janeiro, RJ", "Belo Horizonte, MG", "Vitória, ES", "Campinas, SP", "Niterói, RJ"],
  sul: ["Porto Alegre, RS", "Curitiba, PR", "Florianópolis, SC", "Caxias do Sul, RS", "Londrina, PR", "Joinville, SC"],
};

// ===================== Mock data builder =====================
function buildMockData(region: Region, network: Network): RegionalData {
  // Tabela base de aceitação por combinação
  const baseAcceptance: Record<Region, Record<Network, number>> = {
    norte: { instagram: 48, tiktok: 52, twitter: 35, facebook: 50, youtube: 42 },
    nordeste: { instagram: 60, tiktok: 64, twitter: 41, facebook: 58, youtube: 55 },
    "centro-oeste": { instagram: 53, tiktok: 50, twitter: 44, facebook: 55, youtube: 49 },
    sudeste: { instagram: 71, tiktok: 62, twitter: 48, facebook: 57, youtube: 60 },
    sul: { instagram: 58, tiktok: 49, twitter: 38, facebook: 52, youtube: 53 },
  };

  const acceptance = baseAcceptance[region][network];
  const rejection = Math.max(8, Math.min(85, 100 - acceptance - (10 + ((acceptance * 7) % 13))));
  const mentions = 1500 + ((acceptance * 137 + region.length * 91 + network.length * 53) % 9000);
  const engagement = Math.round((acceptance * 0.6 + (mentions % 40)) * 10) / 10;

  const topNetwork: Record<Region, Network> = {
    norte: "youtube",
    nordeste: "tiktok",
    "centro-oeste": "facebook",
    sudeste: "instagram",
    sul: "twitter",
  };

  const strengthsByRegion: Record<Region, string[]> = {
    norte: [
      "Pautas de infraestrutura e meio ambiente ressoam fortemente na região Norte",
      "Mensagens sobre transporte fluvial e logística amazônica geram engajamento",
      "Defesa de povos tradicionais e ribeirinhos amplia base de apoio",
      "Discurso anti-desmatamento equilibrado com geração de empregos converte indecisos",
      "Presença em comunidades isoladas via vídeos longos é diferencial",
    ],
    nordeste: [
      "Forte apelo cultural com referências regionais (forró, sertão, fé) gera identificação",
      "Pautas sociais como Bolsa Família e SUS têm grande aceitação",
      "Discurso humanizado e com sotaque regional aumenta credibilidade",
      "Defesa do semiárido e agricultura familiar mobiliza eleitorado rural",
      "Mensagens sobre educação pública técnica conectam com jovens",
    ],
    "centro-oeste": [
      "Pauta do agronegócio sustentável tem ampla aceitação",
      "Discurso sobre segurança rural e desenvolvimento converte eleitores",
      "Defesa do produtor rural sem polarizar com meio ambiente é estratégica",
      "Mensagens sobre infraestrutura logística (rodovias, ferrovias) ressoam",
      "Tom conservador moderado tem aderência consistente",
    ],
    sudeste: [
      "Discurso focado em segurança pública ressoa bem no Sudeste",
      "Pautas econômicas e geração de empregos em centros urbanos engajam",
      "Posicionamentos sobre mobilidade urbana e saúde geram debate positivo",
      "Tom mais técnico e dados concretos convencem público mais informado",
      "Defesa de educação de qualidade e empreendedorismo amplia base",
    ],
    sul: [
      "Discurso técnico e propositivo tem boa receptividade no Sul",
      "Pauta de segurança pública e fronteiras mobiliza eleitorado",
      "Defesa do agronegócio e cooperativismo gera identificação",
      "Tom mais formal e debate de ideias é valorizado pela região",
      "Posicionamentos sobre liberdade econômica encontram apoio",
    ],
  };

  const networkRecsLabel: Record<Network, string> = {
    instagram: "no Instagram",
    tiktok: "no TikTok",
    twitter: "no Twitter/X",
    facebook: "no Facebook",
    youtube: "no YouTube",
  };

  const regionLabel: Record<Region, string> = {
    norte: "no Norte",
    nordeste: "no Nordeste",
    "centro-oeste": "no Centro-Oeste",
    sudeste: "no Sudeste",
    sul: "no Sul",
  };

  const recommendations = [
    `${networkRecsLabel[network]} ${regionLabel[region]}: invista em formatos curtos com linguagem local`,
    `Use criadores de conteúdo regionais como pontes de credibilidade`,
    `Adapte o tom para o público típico da plataforma — menos formal no TikTok, mais técnico no Twitter/X`,
    `Crie séries temáticas semanais sobre as principais dores da região`,
    `Responda comentários em massa nas primeiras 2h após cada post para impulsionar alcance`,
  ];

  // Comentários mockados variando por sentimento de acordo com aceitação
  const cities = REGION_CITIES[region];
  const sentimentDist: ("positivo" | "negativo" | "neutro")[] =
    acceptance >= 60
      ? ["positivo", "positivo", "positivo", "neutro", "negativo", "neutro"]
      : acceptance >= 40
        ? ["positivo", "neutro", "negativo", "positivo", "negativo", "neutro"]
        : ["negativo", "negativo", "neutro", "positivo", "negativo", "neutro"];

  const sampleNames = [
    "Ana Souza", "João Lima", "Carlos Pereira", "Mariana Alves",
    "Roberto Dias", "Fernanda Costa", "Lucas Martins", "Patrícia Rocha",
  ];

  const commentTemplates: Record<"positivo" | "negativo" | "neutro", string[]> = {
    positivo: [
      "Finalmente um discurso que escuta a nossa região, tô apoiando!",
      "Gostei muito da proposta, parece que dessa vez vai dar certo.",
      "Esse é o tipo de político que precisamos, foco no que importa.",
      "Concordo demais com essa pauta, tem meu voto.",
    ],
    negativo: [
      "Promessa de campanha pra cima da gente de novo, cansei.",
      "Não acredito mais, já votei e me arrependi.",
      "Discurso bonito mas na prática não muda nada por aqui.",
      "Tá fora da realidade da nossa região, não sabe o que fala.",
    ],
    neutro: [
      "Vou esperar pra ver se vai cumprir o que tá falando.",
      "Tem pontos bons e pontos ruins, ainda tô analisando.",
      "Precisa explicar melhor como vai fazer isso acontecer.",
      "Interessante a proposta, mas falta detalhar os números.",
    ],
  };

  const comments = sentimentDist.map((sentiment, idx) => {
    const dayOffset = idx + 1;
    const date = new Date(Date.now() - dayOffset * 86400000);
    const dateStr = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    const tplArr = commentTemplates[sentiment];
    return {
      name: sampleNames[(idx + region.length) % sampleNames.length],
      city: cities[idx % cities.length],
      date: dateStr,
      text: tplArr[(idx + network.length) % tplArr.length],
      sentiment,
    };
  });

  return {
    acceptance,
    rejection,
    mentions,
    engagement,
    topNetwork: topNetwork[region],
    strengths: strengthsByRegion[region],
    recommendations,
    comments,
  };
}

// ===================== Mapa SVG simples (5 regiões) =====================
const REGION_PATHS: Record<Region, string> = {
  // Paths estilizados aproximando as regiões (não precisão geográfica)
  norte: "M60,40 L260,40 L260,170 L180,200 L60,180 Z",
  nordeste: "M260,40 L360,60 L370,200 L300,220 L260,170 Z",
  "centro-oeste": "M150,180 L260,170 L300,220 L260,290 L150,280 Z",
  sudeste: "M260,220 L340,220 L340,300 L260,310 Z",
  sul: "M180,300 L290,300 L280,370 L190,370 Z",
};

const REGION_LABEL_POS: Record<Region, { x: number; y: number }> = {
  norte: { x: 160, y: 115 },
  nordeste: { x: 315, y: 130 },
  "centro-oeste": { x: 220, y: 235 },
  sudeste: { x: 300, y: 270 },
  sul: { x: 235, y: 340 },
};

function colorByAcceptance(acc: number): string {
  if (acc >= 65) return "hsl(142, 70%, 45%)"; // verde
  if (acc >= 35) return "hsl(45, 95%, 55%)"; // amarelo
  return "hsl(0, 75%, 55%)"; // vermelho
}

// ===================== Componente principal =====================
export default function RegionalAnalysis() {
  const [network, setNetwork] = useState<Network>("instagram");
  const [region, setRegion] = useState<Region>("sudeste");
  const [data, setData] = useState<RegionalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [analyzedRegion, setAnalyzedRegion] = useState<Region | null>(null);
  const [analyzedNetwork, setAnalyzedNetwork] = useState<Network | null>(null);

  // Mapa: precisamos das aceitações de TODAS as regiões para a rede selecionada
  const allRegionsForNetwork = useMemo(() => {
    const map: Record<Region, RegionalData> = {} as Record<Region, RegionalData>;
    REGIONS.forEach((r) => {
      map[r.value] = buildMockData(r.value, analyzedNetwork ?? network);
    });
    return map;
  }, [network, analyzedNetwork]);

  const handleAnalyze = () => {
    setLoading(true);
    setData(null);
    setTimeout(() => {
      setData(buildMockData(region, network));
      setAnalyzedRegion(region);
      setAnalyzedNetwork(network);
      setLoading(false);
    }, 300);
  };

  const networkLabel = (n: Network) => NETWORKS.find((x) => x.value === n)?.label ?? n;
  const regionLabel = (r: Region) => REGIONS.find((x) => x.value === r)?.label ?? r;

  const NetworkIcon = ({ n, className }: { n: Network; className?: string }) => {
    const Icon = NETWORKS.find((x) => x.value === n)?.Icon ?? MessageSquare;
    return <Icon className={className} />;
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabeçalho */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <MapPinned className="h-7 w-7 text-primary" />
          Análise Regional
        </h1>
        <p className="text-muted-foreground mt-1">
          Veja como o seu candidato performa em cada região do Brasil por rede social, com aceitação,
          rejeição, comentários reais e estratégias para melhorar a imagem local.
        </p>
      </div>

      {/* Seletores */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-4 items-end">
            <div>
              <label className="text-sm font-medium mb-2 block">Rede Social</label>
              <Select value={network} onValueChange={(v) => setNetwork(v as Network)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NETWORKS.map((n) => (
                    <SelectItem key={n.value} value={n.value}>
                      <div className="flex items-center gap-2">
                        <n.Icon className="h-4 w-4" />
                        {n.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">Região do Brasil</label>
              <Select value={region} onValueChange={(v) => setRegion(v as Region)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleAnalyze} disabled={loading} size="lg">
              {loading ? "Analisando..." : "Analisar Região"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Estado inicial */}
      {!data && !loading && (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Selecione uma rede social e uma região, e clique em <strong>Analisar Região</strong> para começar.
          </CardContent>
        </Card>
      )}

      {/* Skeletons */}
      {loading && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Skeleton className="h-96 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        </>
      )}

      {data && !loading && (
        <>
          {/* Bloco 1 — Métricas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-green-500">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Taxa de Aceitação</p>
                    <p className="text-3xl font-bold text-green-600">{data.acceptance}%</p>
                  </div>
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Taxa de Rejeição</p>
                    <p className="text-3xl font-bold text-red-600">{data.rejection}%</p>
                  </div>
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-blue-500">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Total de Menções</p>
                    <p className="text-3xl font-bold text-blue-600">
                      {data.mentions.toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <MessageSquare className="h-8 w-8 text-blue-500" />
                </div>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">Índice de Engajamento</p>
                    <p className="text-3xl font-bold text-amber-600">{data.engagement}</p>
                  </div>
                  <Activity className="h-8 w-8 text-amber-500" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bloco 2 — Mapa + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mapa */}
            <Card>
              <CardHeader>
                <CardTitle>Mapa de Aceitação · {networkLabel(analyzedNetwork ?? network)}</CardTitle>
                <CardDescription>
                  Passe o mouse em uma região para ver os detalhes.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TooltipProvider delayDuration={150}>
                  <div className="w-full flex justify-center">
                    <svg viewBox="0 0 420 400" className="w-full max-w-md h-auto">
                      {REGIONS.map((r) => {
                        const d = allRegionsForNetwork[r.value];
                        const fill = colorByAcceptance(d.acceptance);
                        const isSelected = r.value === analyzedRegion;
                        return (
                          <Tooltip key={r.value}>
                            <TooltipTrigger asChild>
                              <path
                                d={REGION_PATHS[r.value]}
                                fill={fill}
                                stroke={isSelected ? "hsl(var(--primary))" : "hsl(var(--background))"}
                                strokeWidth={isSelected ? 4 : 2}
                                className="cursor-pointer transition-all hover:opacity-80"
                              />
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-sm space-y-1">
                                <p className="font-bold">{r.label}</p>
                                <p>✅ Aceitação: <strong>{d.acceptance}%</strong></p>
                                <p>❌ Rejeição: <strong>{d.rejection}%</strong></p>
                                <p className="flex items-center gap-1">
                                  Maior engajamento: <NetworkIcon n={d.topNetwork} className="h-3 w-3" />
                                  <strong>{networkLabel(d.topNetwork)}</strong>
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                      {REGIONS.map((r) => (
                        <text
                          key={r.value}
                          x={REGION_LABEL_POS[r.value].x}
                          y={REGION_LABEL_POS[r.value].y}
                          textAnchor="middle"
                          className="fill-white pointer-events-none"
                          style={{ fontSize: 12, fontWeight: 700, paintOrder: "stroke", stroke: "rgba(0,0,0,0.4)", strokeWidth: 2 }}
                        >
                          {r.label}
                        </text>
                      ))}
                    </svg>
                  </div>
                  <div className="flex flex-wrap justify-center gap-4 mt-4 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded" style={{ background: "hsl(142, 70%, 45%)" }} />
                      Verde = Alta (≥65%)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded" style={{ background: "hsl(45, 95%, 55%)" }} />
                      Amarelo = Média (35–65%)
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4 h-4 rounded" style={{ background: "hsl(0, 75%, 55%)" }} />
                      Vermelho = Baixa (&lt;35%)
                    </div>
                  </div>
                </TooltipProvider>
              </CardContent>
            </Card>

            {/* Insights */}
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Pontos Fortes</CardTitle>
                  <CardDescription>
                    O que mais ressoa em {regionLabel(analyzedRegion ?? region)} no {networkLabel(analyzedNetwork ?? network)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {data.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <span className="text-green-600 font-bold">•</span>
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Como Melhorar na Região</CardTitle>
                  <CardDescription>Recomendações estratégicas para essa combinação</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {data.recommendations.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm">
                        <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Bloco 3 — Comentários */}
          <Card>
            <CardHeader>
              <CardTitle>Comentários da Região</CardTitle>
              <CardDescription>
                Amostra de comentários representativos coletados em {regionLabel(analyzedRegion ?? region)}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.comments.map((c, i) => {
                  const initials = c.name
                    .split(" ")
                    .map((p) => p[0])
                    .slice(0, 2)
                    .join("");
                  const sentimentColor =
                    c.sentiment === "positivo"
                      ? "bg-green-500/15 text-green-700 border-green-500/30"
                      : c.sentiment === "negativo"
                        ? "bg-red-500/15 text-red-700 border-red-500/30"
                        : "bg-amber-500/15 text-amber-700 border-amber-500/30";
                  return (
                    <Card key={i} className="border">
                      <CardContent className="pt-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-primary/15 text-primary flex items-center justify-center font-bold">
                            {initials}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{c.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {c.city} · {c.date}
                            </p>
                          </div>
                          <NetworkIcon
                            n={analyzedNetwork ?? network}
                            className="h-4 w-4 text-muted-foreground"
                          />
                        </div>
                        <p className="text-sm">{c.text}</p>
                        <Badge variant="outline" className={sentimentColor}>
                          {c.sentiment.charAt(0).toUpperCase() + c.sentiment.slice(1)}
                        </Badge>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
