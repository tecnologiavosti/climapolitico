import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Bot, User as UserIcon } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface Msg { role: "user" | "ai"; content: string }
interface Props { eventId: string; region: string | null }

const SUGGESTIONS = [
  "Como repercutiu este evento?",
  "Quais foram os principais temas?",
  "Que críticas se destacaram?",
  "Compare reações positivas e negativas.",
];

export function RegionalChat({ eventId, region }: Props) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async (q: string) => {
    if (!q.trim() || loading) return;
    setMsgs((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("chat-event-region", {
        body: { eventId, region, question: q },
      });
      if (error) throw error;
      setMsgs((m) => [...m, { role: "ai", content: data?.answer || "Sem resposta." }]);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
      setMsgs((m) => [...m, { role: "ai", content: "Não foi possível obter resposta no momento." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-card/40 border-border/40 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Pergunte à IA {region && <span className="text-xs text-muted-foreground font-normal">• Foco: {region}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Sugestões:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" size="sm" className="text-xs h-7" onClick={() => ask(s)} disabled={loading}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-3 max-h-[300px] overflow-y-auto">
          {msgs.map((m, i) => (
            <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
              {m.role === "ai" && <div className="p-1.5 rounded-full bg-primary/10 h-7 w-7 flex items-center justify-center shrink-0"><Bot className="h-3.5 w-3.5 text-primary" /></div>}
              <div className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-background/60 border border-border/40"}`}>
                {m.content}
              </div>
              {m.role === "user" && <div className="p-1.5 rounded-full bg-muted h-7 w-7 flex items-center justify-center shrink-0"><UserIcon className="h-3.5 w-3.5" /></div>}
            </div>
          ))}
          {loading && (
            <div className="flex gap-2">
              <div className="p-1.5 rounded-full bg-primary/10 h-7 w-7 flex items-center justify-center"><Bot className="h-3.5 w-3.5 text-primary animate-pulse" /></div>
              <div className="rounded-lg px-3 py-2 text-sm bg-background/60 border border-border/40 text-muted-foreground">Analisando comentários reais...</div>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre a repercussão regional..."
            className="min-h-[44px] resize-none bg-background/40 border-border/60 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          />
          <Button onClick={() => ask(input)} disabled={loading || !input.trim()} size="icon" className="shrink-0">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
