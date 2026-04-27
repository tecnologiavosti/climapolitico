import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Youtube,
  Twitter,
  Instagram,
  Facebook,
  MessageCircle,
  Send,
  Newspaper,
  BookOpen,
  Music2,
  Globe,
  Clock,
  Database,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

interface PlatformInfo {
  name: string;
  icon: any;
  color: string;
  method: string;
  cron: string;
  details: string;
  whatWeCollect: string[];
  limits: string;
  tip: string;
}

const PLATFORMS: PlatformInfo[] = [
  {
    name: "YouTube",
    icon: Youtube,
    color: "#FF0000",
    method: "API Oficial do YouTube (YouTube Data API v3)",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "A gente usa a API oficial do Google pra buscar vídeos que falam do seu candidato. Depois, entra em cada vídeo e pega os comentários do público. Tudo de forma legal e autorizada pela plataforma.",
    whatWeCollect: [
      "Até 8 vídeos por candidato a cada coleta",
      "Até 30 comentários de cada vídeo",
      "Curtidas, respostas e nome de quem comentou",
      "Data e horário da postagem original",
    ],
    limits:
      "O Google libera uma cota diária de buscas. Se acabar, esperamos o próximo dia. Por isso usamos várias chaves de API que se revezam automaticamente.",
    tip: "Os dados do YouTube são os mais ricos porque vêm direto da fonte oficial e incluem reações detalhadas do público.",
  },
  {
    name: "Twitter / X",
    icon: Twitter,
    color: "#1DA1F2",
    method: "API Oficial do X (Twitter API v2) + scraping de backup",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "Buscamos posts (tweets) que mencionam o candidato pelo nome ou @ usando a API oficial do X. Quando a API tem limite atingido, usamos um sistema reserva (Nitter) que lê posts públicos sem precisar de login.",
    whatWeCollect: [
      "Até 200 tweets por busca",
      "Até 4 páginas de resultados por candidato",
      "Curtidas, retweets, respostas",
      "Perfil de quem postou e data do tweet",
    ],
    limits:
      "O X é a rede mais restrita: tem limite de quantas buscas podemos fazer por mês. Por isso priorizamos os candidatos mais ativos.",
    tip: "Tweets reagem muito rápido a notícias e debates — ótimos pra medir o clima imediato.",
  },
  {
    name: "Instagram",
    icon: Instagram,
    color: "#E4405F",
    method: "API do Meta (via Apify) + coleta em massa",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "Como o Instagram é fechado, usamos uma ferramenta autorizada (Apify) que acessa posts públicos de candidatos, jornalistas e páginas que comentam política. Pegamos só conteúdo aberto, nunca privado.",
    whatWeCollect: [
      "Comentários em posts públicos do candidato",
      "Comentários em posts de jornalistas e influenciadores políticos",
      "Curtidas e respostas em cada comentário",
      "Perfil público de quem comentou",
    ],
    limits:
      "Só pegamos contas e posts que estão públicos. Perfis privados ficam de fora — respeitamos a privacidade de todo mundo.",
    tip: "Instagram mostra muito bem o engajamento emocional do público mais jovem.",
  },
  {
    name: "Facebook",
    icon: Facebook,
    color: "#1877F2",
    method: "API do Meta (via Apify) — mesma do Instagram",
    cron: "A cada 6 horas (junto com o Instagram)",
    details:
      "Acessamos páginas oficiais e fan pages públicas que falam do candidato. Pegamos os comentários das postagens. Tudo dentro do que o Facebook permite via API oficial do Meta.",
    whatWeCollect: [
      "Comentários em posts públicos de páginas",
      "Reações (curtir, amei, haha, triste, raiva)",
      "Compartilhamentos visíveis publicamente",
      "Nome público de quem comentou",
    ],
    limits:
      "Não acessamos perfis pessoais nem grupos privados. Só páginas públicas e oficiais.",
    tip: "O Facebook ainda é forte entre o público mais velho — bom pra entender o eleitor 40+.",
  },
  {
    name: "TikTok",
    icon: Music2,
    color: "#000000",
    method: "API Oficial do TikTok (via Apify)",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "Buscamos vídeos do TikTok que mencionam o candidato ou usam hashtags políticas relevantes. Coletamos os comentários públicos desses vídeos.",
    whatWeCollect: [
      "Vídeos com hashtags políticas e nome do candidato",
      "Comentários públicos de cada vídeo",
      "Curtidas, compartilhamentos e visualizações",
      "@ público de quem comentou",
    ],
    limits:
      "TikTok limita quantos vídeos podemos buscar por dia. Focamos nos vídeos com mais engajamento pra ter uma amostra representativa.",
    tip: "TikTok é o termômetro do eleitor jovem. As tendências viralizam aqui antes de qualquer outra rede.",
  },
  {
    name: "Reddit",
    icon: MessageCircle,
    color: "#FF4500",
    method: "API Oficial do Reddit (JSON pública)",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "O Reddit tem uma API aberta e gratuita. A gente busca posts e comentários em comunidades brasileiras (subreddits) sobre política, como r/brasil, r/politica, e outros relacionados.",
    whatWeCollect: [
      "Posts (threads) que mencionam o candidato",
      "Comentários e respostas dentro das threads",
      "Pontuação (upvotes/downvotes) de cada post",
      "Username público de quem postou",
    ],
    limits:
      "Coletamos só comunidades em português. Tudo é público — Reddit é uma rede aberta por natureza.",
    tip: "No Reddit o pessoal debate em texto longo e argumentado. Ótimo pra entender o porquê das opiniões, não só o quê.",
  },
  {
    name: "Telegram",
    icon: Send,
    color: "#0088CC",
    method: "Busca em canais e grupos públicos",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "O Telegram tem milhares de canais e grupos públicos sobre política. A gente busca menções ao candidato apenas em canais abertos a qualquer pessoa. Nunca acessamos grupos privados ou conversas pessoais.",
    whatWeCollect: [
      "Mensagens em canais públicos de notícias e política",
      "Reações (emojis) de cada mensagem",
      "Quantas vezes a mensagem foi vista",
      "Nome público do canal de origem",
    ],
    limits:
      "Telegram não tem API de busca global oficial. Por isso usamos uma lista curada de canais públicos relevantes.",
    tip: "Telegram é importante porque é onde circulam muitas notícias políticas — inclusive informações que viram polêmica em outras redes.",
  },
  {
    name: "Wikipedia",
    icon: BookOpen,
    color: "#636363",
    method: "API Oficial da Wikipedia (MediaWiki API)",
    cron: "Semanalmente (1 vez por semana)",
    details:
      "Buscamos a página oficial do candidato na Wikipedia em português. Pegamos o conteúdo do artigo, histórico de edições recentes e categorias. Tudo público e colaborativo.",
    whatWeCollect: [
      "Texto completo do artigo do candidato",
      "Datas e tipo das últimas edições",
      "Resumo biográfico oficial",
      "Categorias políticas (partido, cargo, região)",
    ],
    limits:
      "A Wikipedia muda pouco — por isso atualizamos só uma vez por semana. Economiza recursos sem perder informação.",
    tip: "A Wikipedia mostra como o candidato está sendo registrado pra história. Edições polêmicas costumam revelar disputas narrativas.",
  },
  {
    name: "Google News",
    icon: Newspaper,
    color: "#22C55E",
    method: "RSS Feed do Google News (gratuito e público)",
    cron: "A cada 3 horas (8 vezes por dia)",
    details:
      "O Google News tem um sistema de RSS (uma 'lista atualizada' de notícias) totalmente gratuito. A gente assina essa lista pesquisando pelo nome do candidato e recebe automaticamente todas as matérias novas que jornais brasileiros publicam.",
    whatWeCollect: [
      "Título e link de cada notícia",
      "Nome do veículo que publicou (Folha, G1, UOL, etc.)",
      "Data e hora da publicação",
      "Trecho inicial (resumo) da matéria",
    ],
    limits:
      "Não pegamos a matéria completa — só o que o Google News disponibiliza no RSS. Pra ler tudo, basta clicar no link.",
    tip: "Google News é nossa fonte mais rápida e barata. Atualizamos a cada 3h justamente porque notícia política muda muito rápido.",
  },
  {
    name: "Brand24",
    icon: Globe,
    color: "#7C3AED",
    method: "RSS Feed do Brand24 (monitoramento profissional)",
    cron: "A cada 6 horas (4 vezes por dia)",
    details:
      "O Brand24 é um serviço profissional de monitoramento de marca. A gente assina o RSS deles, que inclui menções vindas de blogs, fóruns, sites de nicho e fontes que as outras APIs não cobrem.",
    whatWeCollect: [
      "Menções em blogs e sites independentes",
      "Posts em fóruns regionais",
      "Notícias de veículos menores",
      "Sentimento já pré-classificado pelo Brand24",
    ],
    limits:
      "Depende do plano contratado no Brand24. É uma fonte complementar pra cobrir o que as APIs grandes deixam passar.",
    tip: "O Brand24 cobre as 'pontas soltas' da internet — perfeito pra ver o que a mídia regional e independente está falando.",
  },
];

export default function DataCollectionMethodology() {
  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Como Coletamos os Dados</h1>
        </div>
        <p className="text-muted-foreground max-w-3xl">
          Aqui você entende, de forma simples, como cada rede social é monitorada pela plataforma:
          qual método usamos, de quanto em quanto tempo coletamos, e o que conseguimos enxergar de cada uma.
        </p>
      </div>

      {/* Resumo geral */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Como funciona, em 3 passos</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0">1</Badge>
            <p>
              <strong>Buscamos automaticamente</strong> menções ao seu candidato em cada rede,
              em horários programados (de 3 em 3 horas, de 6 em 6 horas, dependendo da rede).
            </p>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0">2</Badge>
            <p>
              <strong>Salvamos no nosso banco de dados</strong> só o que é público — comentários,
              curtidas, posts. Nunca acessamos mensagens privadas ou contas fechadas.
            </p>
          </div>
          <div className="flex gap-3">
            <Badge variant="outline" className="shrink-0">3</Badge>
            <p>
              <strong>A IA analisa o sentimento</strong> de cada menção (positivo, negativo ou neutro)
              e gera os gráficos e relatórios que você vê na plataforma.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Cards de cada plataforma */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {PLATFORMS.map((platform) => {
          const Icon = platform.icon;
          return (
            <Card key={platform.name} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div
                    className="p-2.5 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${platform.color}15` }}
                  >
                    <Icon className="h-6 w-6" style={{ color: platform.color }} />
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-xl">{platform.name}</CardTitle>
                    <CardDescription className="text-xs mt-1">
                      {platform.method}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-4 text-sm">
                {/* Frequência */}
                <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
                  <Clock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                      Frequência da coleta
                    </p>
                    <p className="mt-1">{platform.cron}</p>
                  </div>
                </div>

                {/* Como funciona */}
                <div>
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    Como funciona
                  </p>
                  <p className="text-foreground/90 leading-relaxed">{platform.details}</p>
                </div>

                {/* O que coletamos */}
                <div>
                  <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide mb-2">
                    O que coletamos
                  </p>
                  <ul className="space-y-1.5">
                    {platform.whatWeCollect.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span
                          className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                          style={{ backgroundColor: platform.color }}
                        />
                        <span className="text-foreground/80">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Limites */}
                <div className="flex items-start gap-2 p-3 rounded-lg border border-border/50">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">
                      Limites e privacidade
                    </p>
                    <p className="mt-1 text-foreground/80">{platform.limits}</p>
                  </div>
                </div>

                <Separator />

                {/* Dica */}
                <div className="flex items-start gap-2">
                  <Sparkles className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-foreground/90 italic">{platform.tip}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Rodapé explicativo */}
      <Card className="bg-muted/30">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Compromisso com a privacidade
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2 text-foreground/80">
          <p>
            <strong>Tudo que coletamos é público.</strong> Nunca acessamos mensagens privadas,
            grupos fechados, perfis pessoais ou contas que estão com privacidade ativada.
          </p>
          <p>
            <strong>Usamos APIs oficiais sempre que possível.</strong> Quando uma rede não tem API
            pública (como Telegram), buscamos só em canais abertos a qualquer pessoa.
          </p>
          <p>
            <strong>Os dados são armazenados de forma segura</strong> e usados apenas pra gerar
            os gráficos e relatórios que você vê dentro da plataforma.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
