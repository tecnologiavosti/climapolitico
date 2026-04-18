import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, ExternalLink, Filter } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { SocialInteraction } from "@/hooks/useRealTimeAnalytics";

interface RealTimeCommentsFeedProps {
  comments: SocialInteraction[];
}

const networkIcons: Record<string, string> = {
  'Instagram': '📸',
  'Twitter': '𝕏',
  'Twitter/X': '𝕏',
  'X': '𝕏',
  'Facebook': '📘',
  'TikTok': '🎵',
  'YouTube': '▶️',
  'LinkedIn': '💼',
  'Threads': '🧵',
  'Reddit': '👽',
};

const sentimentConfig = {
  'Positivo': { color: 'bg-green-500/10 text-green-600 border-green-500/20', label: 'Positivo' },
  'Neutro': { color: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', label: 'Neutro' },
  'Negativo': { color: 'bg-red-500/10 text-red-600 border-red-500/20', label: 'Negativo' },
};

export const RealTimeCommentsFeed = ({ comments }: RealTimeCommentsFeedProps) => {
  const [filter, setFilter] = useState<string>('all');
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const prevCommentsRef = useRef<string[]>([]);

  // Detect new comments and highlight them
  useEffect(() => {
    const currentIds = comments.map(c => c.id);
    const newIds = currentIds.filter(id => !prevCommentsRef.current.includes(id));
    
    if (newIds.length > 0) {
      setHighlightedIds(new Set(newIds));
      // Remove highlight after 3 seconds
      setTimeout(() => {
        setHighlightedIds(new Set());
      }, 3000);
    }
    
    prevCommentsRef.current = currentIds;
  }, [comments]);

  const filteredComments = comments.filter(comment => {
    if (filter === 'all') return true;
    return comment.sentiment_label === filter;
  });

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feed em Tempo Real
          </CardTitle>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="Positivo">Positivos</SelectItem>
              <SelectItem value="Neutro">Neutros</SelectItem>
              <SelectItem value="Negativo">Negativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          {filteredComments.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-2 opacity-20" />
              <p>Nenhum comentário ainda</p>
              <p className="text-sm">Novos comentários aparecerão aqui em tempo real</p>
            </div>
          ) : (
            <div className="divide-y">
              {filteredComments.map((comment) => {
                const isNew = highlightedIds.has(comment.id);
                const sentiment = comment.sentiment_label as keyof typeof sentimentConfig;
                const sentimentStyle = sentimentConfig[sentiment] || sentimentConfig['Neutro'];

                return (
                  <div
                    key={comment.id}
                    className={cn(
                      "p-4 transition-all duration-500",
                      isNew && "bg-primary/5 animate-pulse"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {/* Network icon */}
                      <div className="text-2xl">
                        {networkIcons[comment.social_network] || '💬'}
                      </div>

                      <div className="flex-1 min-w-0">
                        {/* Header */}
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-medium truncate">
                            {comment.comment_author || 'Usuário anônimo'}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {comment.social_network}
                          </Badge>
                          <Badge className={cn("text-xs", sentimentStyle.color)}>
                            {sentimentStyle.label}
                          </Badge>
                        </div>

                        {/* Comment text */}
                        <p className="text-sm text-muted-foreground line-clamp-3 mb-2">
                          {comment.comment_text || 'Sem texto disponível'}
                        </p>

                        {/* Footer */}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>
                            {formatDistanceToNow(new Date(comment.created_at), {
                              addSuffix: true,
                              locale: ptBR,
                            })}
                          </span>
                          {comment.likes_count > 0 && (
                            <span>❤️ {comment.likes_count}</span>
                          )}
                          {comment.replies_count > 0 && (
                            <span>💬 {comment.replies_count}</span>
                          )}
                          {comment.author_profile_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0 text-xs"
                              asChild
                            >
                              <a
                                href={comment.author_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Ver perfil
                              </a>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
