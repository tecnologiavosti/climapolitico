import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MessageSquare, TrendingUp, Mic, Radio, Newspaper, Search, Video, Megaphone, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type EventItem = {
  id: string;
  event_name: string;
  event_type: string;
  event_date: string;
  description?: string | null;
  keywords?: string[];
  metadata?: any;
};

interface Props {
  events: EventItem[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry?: () => void;
  retrying?: boolean;
}

const TYPE_ICON: Record<string, any> = {
  entrevista: Mic, debate: Megaphone, live: Video, podcast: Mic, discurso: Megaphone,
  comicio: Megaphone, noticia: Newspaper, coletiva: Mic, agenda: MapPin,
  evento: MapPin, programa: Video, declaracao: Megaphone, outro: MessageSquare,
};

const TYPE_LABEL: Record<string, string> = {
  entrevista: "Entrevista", debate: "Debate", live: "Live", podcast: "Podcast",
  discurso: "Discurso", comicio: "Comício", noticia: "Notícia", coletiva: "Coletiva",
  agenda: "Agenda", evento: "Evento", programa: "Programa", declaracao: "Declaração",
  outro: "Outro",
};

const TYPE_EMOJI: Record<string, string> = {
  entrevista: "🎙", debate: "🗣", live: "📺", podcast: "🎧", discurso: "🗣",
  comicio: "📢", noticia: "📰", coletiva: "🎤", agenda: "📍", evento: "📍",
  programa: "📺", declaracao: "💬", outro: "💬",
};

export function EventSelectorList({ events, loading, selectedId, onSelect, onRetry, retrying }: Props) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (type !== "all" && e.event_type !== type) return false;
      if (!q.trim()) return true;
      const ql = q.toLowerCase();
      return (e.event_name?.toLowerCase().includes(ql) || (e.description || "").toLowerCase().includes(ql));
    });
  }, [events, q, type]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar evento..." className="pl-9 bg-background/40 border-border/60" />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="bg-background/40 border-border/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            <SelectItem value="entrevista">Entrevista</SelectItem>
            <SelectItem value="debate">Debate</SelectItem>
            <SelectItem value="live">Live</SelectItem>
            <SelectItem value="podcast">Podcast</SelectItem>
            <SelectItem value="discurso">Discurso</SelectItem>
            <SelectItem value="comicio">Comício</SelectItem>
            <SelectItem value="coletiva">Coletiva</SelectItem>
            <SelectItem value="agenda">Agenda pública</SelectItem>
            <SelectItem value="evento">Evento</SelectItem>
            <SelectItem value="programa">Programa</SelectItem>
            <SelectItem value="noticia">Notícia</SelectItem>
            <SelectItem value="declaracao">Declaração</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
        {loading && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/40 bg-card/40 p-3 animate-pulse">
            <div className="flex items-start gap-2">
              <div className="h-7 w-7 rounded-md bg-muted/40" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-4/5 rounded bg-muted/40" />
                <div className="h-2.5 w-2/3 rounded bg-muted/30" />
                <div className="h-2 w-1/2 rounded bg-muted/20" />
              </div>
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8 space-y-3">
            <p>Nenhum evento encontrado para este período.</p>
            {onRetry && (
              <button
                onClick={onRetry}
                disabled={retrying}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-primary/40 text-primary hover:bg-primary/10 transition disabled:opacity-50"
              >
                Tentar novamente
              </button>
            )}
          </div>
        )}
        {!loading && filtered.map((e) => {
          const Icon = TYPE_ICON[e.event_type] || MessageSquare;
          const emoji = TYPE_EMOJI[e.event_type] || "•";
          const volume = e.metadata?.mentions_estimate || e.metadata?.spike_volume || 0;
          const subtitle = e.metadata?.subtitle || e.description;
          const location = e.metadata?.location;
          const selected = selectedId === e.id;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary/60 ${selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/.5)]" : "border-border/40 bg-card/40"}`}
            >
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-md bg-primary/10 mt-0.5 flex items-center justify-center w-7 h-7 text-base leading-none">
                  <span aria-hidden>{emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-tight line-clamp-2">{e.event_name}</p>
                  {subtitle && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">{subtitle}</p>
                  )}
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="text-[10px] h-5 px-1.5">{TYPE_LABEL[e.event_type] || e.event_type}</Badge>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(e.event_date), "dd/MM • HH:mm", { locale: ptBR })}
                    </span>
                    {location && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1 truncate max-w-[120px]">
                        <MapPin className="h-3 w-3" />{location}
                      </span>
                    )}
                    {volume > 0 && (
                      <span className="text-[11px] text-primary/90 flex items-center gap-1 font-medium">
                        <MessageSquare className="h-3 w-3" />{volume.toLocaleString("pt-BR")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
