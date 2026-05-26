import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Heart, ExternalLink, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import type { SocialInteraction } from "@/hooks/useRealTimeAnalytics";

interface Props {
  comments: SocialInteraction[];
  isLoading?: boolean;
}

const networkIcons: Record<string, string> = {
  Instagram: "📸", Twitter: "𝕏", "Twitter/X": "𝕏", X: "𝕏",
  Facebook: "📘", TikTok: "🎵", YouTube: "▶️", LinkedIn: "💼",
  Threads: "🧵", Reddit: "👽", Bluesky: "🦋", Telegram: "✈️", "Google News": "📰",
};

const sentimentTone: Record<string, { bg: string; text: string; dot: string }> = {
  Positivo: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-500", dot: "bg-emerald-500" },
  Neutro:   { bg: "bg-amber-500/10 border-amber-500/30",     text: "text-amber-500",   dot: "bg-amber-500" },
  Negativo: { bg: "bg-red-500/10 border-red-500/30",         text: "text-red-500",     dot: "bg-red-500" },
};

const initials = (name?: string | null) =>
  (name || "?").split(/\s+/).slice(0, 2).map(s => s[0]?.toUpperCase() ?? "").join("");

const SentimentChip = ({ active, value, label, color, onClick }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
      active ? "border-transparent text-foreground shadow-sm" : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
    )}
    style={active ? { backgroundColor: `${color}20`, color, borderColor: `${color}66` } : undefined}
  >
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    {label}
  </button>
);

const NetworkChip = ({ active, label, onClick }: any) => (
  <button
    onClick={onClick}
    className={cn(
      "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
      active
        ? "border-primary/50 bg-primary/10 text-primary"
        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
    )}
  >
    {label}
  </button>
);

const FeedSkeleton = () => (
  <div className="divide-y divide-border/40">
    {[...Array(6)].map((_, i) => (
      <div key={i} className="p-3 flex gap-3">
        <div className="h-9 w-9 rounded-full bg-muted animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-32 rounded bg-muted animate-pulse" />
          <div className="h-3 w-full rounded bg-muted animate-pulse" />
          <div className="h-3 w-2/3 rounded bg-muted animate-pulse" />
        </div>
      </div>
    ))}
  </div>
);

export const RealTimeCommentsFeed = ({ comments, isLoading }: Props) => {
  const [sentiment, setSentiment] = useState<"all" | "Positivo" | "Neutro" | "Negativo" | "Pendente">("all");
  const [network, setNetwork] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const networks = useMemo(() => {
    const set = new Set<string>();
    comments.forEach(c => c.social_network && set.add(c.social_network));
    return Array.from(set);
  }, [comments]);

  const validLabels = new Set(["Positivo", "Neutro", "Negativo"]);
  const isPending = (c: SocialInteraction) => !c.sentiment_label || !validLabels.has(c.sentiment_label);
  const pendingCount = comments.filter(isPending).length;

  const filtered = comments.filter(c => {
    if (sentiment === "Pendente") {
      if (!isPending(c)) return false;
    } else if (sentiment !== "all") {
      if (c.sentiment_label !== sentiment) return false;
    }
    if (network !== "all" && c.social_network !== network) return false;
    return true;
  });

  return (
    <Card className="border-border/60 bg-card/60 backdrop-blur-sm h-full flex flex-col">
      <CardHeader className="pb-3 space-y-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            Feed em tempo real
          </CardTitle>
          <Badge variant="outline" className="text-[10px] font-medium gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ao vivo
          </Badge>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <SentimentChip active={sentiment === "all"} label={`Todos (${comments.length})`} color="hsl(var(--primary))" onClick={() => setSentiment("all")} />
          <SentimentChip active={sentiment === "Positivo"} label="Positivos" color="#22c55e" onClick={() => setSentiment("Positivo")} />
          <SentimentChip active={sentiment === "Neutro"} label="Neutros" color="#eab308" onClick={() => setSentiment("Neutro")} />
          <SentimentChip active={sentiment === "Negativo"} label="Negativos" color="#ef4444" onClick={() => setSentiment("Negativo")} />
          {pendingCount > 0 && (
            <SentimentChip active={sentiment === "Pendente"} label={`Pendentes (${pendingCount})`} color="#94a3b8" onClick={() => setSentiment("Pendente")} />
          )}
        </div>

        {networks.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-1 px-1">
            <NetworkChip active={network === "all"} label="Todas redes" onClick={() => setNetwork("all")} />
            {networks.map(n => (
              <NetworkChip key={n} active={network === n} label={n} onClick={() => setNetwork(n)} />
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="p-0 flex-1 min-h-0">
        <ScrollArea className="h-[480px]">
          {isLoading ? (
            <FeedSkeleton />
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhum comentário no filtro atual</p>
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              <AnimatePresence initial={false}>
                {filtered.map((c, idx) => {
                  const tone = sentimentTone[c.sentiment_label ?? ""] ?? sentimentTone.Neutro;
                  const expanded = expandedId === c.id;
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25, delay: Math.min(idx * 0.015, 0.2) }}
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="group cursor-pointer p-3 hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex gap-3">
                        <div className="relative shrink-0">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center text-xs font-semibold text-foreground/80">
                            {initials(c.comment_author)}
                          </div>
                          <div className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-background flex items-center justify-center text-[9px] border border-border/60">
                            {networkIcons[c.social_network] ?? "•"}
                          </div>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-medium truncate max-w-[180px]">
                              {c.comment_author || "Usuário"}
                            </span>
                            <span className="text-[10px] text-muted-foreground">{c.social_network}</span>
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium border", tone.bg, tone.text)}>
                              <span className={cn("h-1 w-1 rounded-full", tone.dot)} />
                              {c.sentiment_label || "—"}
                            </span>
                            {typeof c.sentiment_score === "number" && (
                              <span className="text-[10px] font-mono tabular-nums text-muted-foreground" title="Score interno (-100 a +100)">
                                {c.sentiment_label === "Positivo" ? "🟢" : c.sentiment_label === "Negativo" ? "🔴" : "🟡"}
                                {c.sentiment_score > 0 ? "+" : ""}{Math.round(c.sentiment_score * 100)}
                              </span>
                            )}
                            {typeof c.sentiment_confidence === "number" && c.sentiment_confidence < 0.5 && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/40">
                                baixa confiança
                              </span>
                            )}
                          </div>

                          <p className={cn(
                            "text-xs text-muted-foreground/90 leading-relaxed",
                            !expanded && "line-clamp-2"
                          )}>
                            {c.comment_text || "Sem texto disponível"}
                          </p>

                          <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground">
                            <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}</span>
                            {c.likes_count > 0 && (
                              <span className="inline-flex items-center gap-0.5"><Heart className="h-3 w-3" /> {c.likes_count}</span>
                            )}
                            {c.replies_count > 0 && (
                              <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" /> {c.replies_count}</span>
                            )}
                            {c.author_profile_url && (
                              <a
                                href={c.author_profile_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ExternalLink className="h-3 w-3" /> perfil
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
};
