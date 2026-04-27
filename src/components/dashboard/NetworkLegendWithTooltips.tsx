import { ReactNode } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTooltipsEnabled } from "@/hooks/useTooltipsEnabled";

interface NetworkLegendWithTooltipsProps {
  data: Array<{ name: string; value: number; color: string }>;
}

/**
 * Metodologias de coleta por rede social - explicadas de forma humanizada
 */
const NETWORK_METHODOLOGIES: Record<string, string> = {
  "YouTube": "Buscamos vídeos e comentários públicos usando a API oficial do YouTube. Pegamos os primeiros 30 comentários de cada vídeo.",
  
  "Twitter/X": "Coletamos posts públicos que mencionam seu candidato usando a API oficial do X (Twitter). Limitamos a 200 tweets por busca.",
  
  "Twitter": "Coletamos posts públicos que mencionam seu candidato usando a API oficial do X (Twitter). Limitamos a 200 tweets por busca.",
  
  "X": "Coletamos posts públicos que mencionam seu candidato usando a API oficial do X (Twitter). Limitamos a 200 tweets por busca.",
  
  "Google News": "Buscamos notícias de jornais e sites de notícias pelo Google News. Pegamos o título e trecho das matérias.",
  
  "Wikipedia": "Monitoramos páginas da Wikipedia sobre política e eleições para pegar menções em artigos colaborativos.",
  
  "Reddit": "Buscamos posts e comentários em fóruns públicos do Brasil. Coletamos de comunidades (subreddits) sobre política.",
  
  "Telegram": "Buscamos em grupos e canais públicos do Telegram que discutem política e eleições. Só conteúdo aberto.",
  
  "Instagram": "Coletamos comentários de posts públicos usando a API oficial do Meta. Focamos em contas de políticos e jornalistas.",
  
  "Facebook": "Buscamos comentários em posts públicos de páginas oficiais usando a API do Meta. Só conteúdo público.",
  
  "TikTok": "Coletamos vídeos e comentários públicos usando a API oficial do TikTok. Pegamos posts com hashtags políticas.",
  
  "LinkedIn": "Buscamos posts públicos de políticos e empresários no LinkedIn usando a API oficial da plataforma.",
  
  "Threads": "Coletamos posts públicos do Threads usando a API do Meta. Buscamos menções diretas ao candidato.",
  
  "Outro": "Outras fontes de dados que não se encaixam nas redes principais, como blogs e sites independentes.",
};

/**
 * Legenda customizada para o gráfico de redes sociais com tooltips explicativos
 * sobre a metodologia de coleta de cada rede.
 */
export function NetworkLegendWithTooltips({ data }: NetworkLegendWithTooltipsProps) {
  const enabled = useTooltipsEnabled();
  
  if (data.length === 0) return null;
  
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4 px-2">
      {data.map((item) => {
        const percentage = total > 0 ? ((item.value / total) * 100).toFixed(0) : '0';
        const tooltipText = NETWORK_METHODOLOGIES[item.name] || `Dados coletados da ${item.name}.`;
        
        const LegendItem = (
          <div 
            className={`flex items-center gap-2 text-xs ${enabled ? 'cursor-help' : ''}`}
          >
            <span
              className="inline-block rounded-sm"
              style={{ 
                backgroundColor: item.color, 
                width: '10px', 
                height: '10px',
              }}
            />
            <span className="text-muted-foreground">
              {item.name} ({percentage}%)
            </span>
          </div>
        );
        
        if (!enabled) {
          return (
            <div key={item.name}>
              {LegendItem}
            </div>
          );
        }
        
        return (
          <TooltipProvider key={item.name} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                {LegendItem}
              </TooltipTrigger>
              <TooltipContent 
                side="top" 
                className="max-w-xs text-xs leading-snug"
                sideOffset={8}
              >
                {tooltipText}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
    </div>
  );
}
