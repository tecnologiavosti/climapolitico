import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, MessageSquare, TrendingUp, Mic, Radio, Newspaper, Search } from "lucide-react";
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
  entrevista: Mic, debate: Mic, live: Radio, podcast: Mic, discurso: Mic,
  comicio: TrendingUp, noticia: Newspaper, pico: TrendingUp, outro: MessageSquare,
};

const TYPE_LABEL: Record<string, string> = {
  entrevista: "Entrevista", debate: "Debate", live: "Live", podcast: "Podcast",
  discurso: "Discurso", comicio: "Comício", noticia: "Notícia", pico: "Pico", outro: "Outro",
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
            <SelectItem value="noticia">Notícia</SelectItem>
            <SelectItem value="pico">Pico de menções</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {loading && Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="bg-card/40 border-border/40 animate-pulse"><CardContent className="h-20 p-3" /></Card>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8">Nenhum evento detectado. Use o botão "Detectar eventos" no topo.</div>
        )}
        {!loading && filtered.map((e) => {
          const Icon = TYPE_ICON[e.event_type] || MessageSquare;
          const volume = e.metadata?.spike_volume || e.metadata?.mentions_estimate || 0;
          const selected = selectedId === e.id;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              className={`w-full text-left rounded-lg border p-3 transition-all hover:border-primary/60 ${selected ? "border-primary bg-primary/10" : "border-border/40 bg-card/40"}`}
            >
              <div className="flex items-start gap-2">
                <div className="p-1.5 rounded-md bg-primary/10 mt-0.5"><Icon className="h-3.5 w-3.5 text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight line-clamp-2">{e.event_name}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <Badge variant="outline" className="text-[10px] h-5">{TYPE_LABEL[e.event_type] || e.event_type}</Badge>
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {format(new Date(e.event_date), "dd/MM HH:mm", { locale: ptBR })}
                    </span>
                    {volume > 0 && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />{volume}
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
}
