import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { ExternalLink, Landmark, Newspaper, Radio } from "lucide-react";
import { RadarEvent, useRadarEventSources } from "@/hooks/useRadarEvents";

const SIZE_LABEL: Record<string, string> = {
  grande: "Grande", medio: "Médio", pequeno: "Pequeno",
};

export function RadarEventSheet({
  open, onOpenChange, event,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  event: RadarEvent | null;
}) {
  const { data: sources, isLoading } = useRadarEventSources(event?.id ?? null);
  if (!event) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-[10px] uppercase">{SIZE_LABEL[event.size]}</Badge>
            {event.category && <Badge variant="outline" className="text-[10px] capitalize">{event.category}</Badge>}
          </div>
          <SheetTitle className="text-lg leading-snug text-left">{event.title}</SheetTitle>
          <SheetDescription className="text-left text-xs">
            {new Date(event.event_date).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-6 space-y-6">
            {event.summary && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Resumo</h3>
                <p className="text-sm leading-relaxed text-foreground/90">{event.summary}</p>
              </section>
            )}

            <section className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Fontes</div>
                <div className="font-mono text-xl font-semibold">{event.source_count}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Repercussão</div>
                <div className="font-mono text-xl font-semibold">{Math.round(event.social_score)}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-[10px] uppercase text-muted-foreground">Importância</div>
                <div className="font-mono text-xl font-semibold">{Math.round(event.importance)}</div>
              </div>
            </section>

            <Separator />

            <section className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Fontes ({sources?.length ?? 0})
              </h3>
              {isLoading ? (
                <p className="text-xs text-muted-foreground">Carregando fontes…</p>
              ) : sources && sources.length > 0 ? (
                <ul className="space-y-2">
                  {sources.map((s) => {
                    const Icon = s.is_institutional ? Landmark : s.is_major_media ? Newspaper : Radio;
                    return (
                      <li key={s.id} className="flex items-start gap-2 text-xs border rounded p-2 hover:bg-muted/40 transition-colors">
                        <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                        <div className="flex-1 min-w-0">
                          <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-foreground hover:underline line-clamp-2 inline-flex items-center gap-1">
                            {s.title || s.source_name}
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-2">
                            <span className="font-semibold">{s.source_name}</span>
                            {s.published_at && (
                              <span>· {new Date(s.published_at).toLocaleDateString("pt-BR")}</span>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground italic">Nenhuma fonte registrada.</p>
              )}
            </section>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
