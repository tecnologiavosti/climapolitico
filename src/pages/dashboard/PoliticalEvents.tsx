import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, Plus, Trash2, TrendingUp, TrendingDown, Minus, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

const EVENT_TYPES = ["entrevista", "debate", "comicio", "discurso", "polemica", "outro"] as const;

export default function PoliticalEvents() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const handleAutoDetect = async () => {
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("auto-detect-events", { body: { days: 30, spike_multiplier: 2.0 } });
      if (error) throw error;
      const n = data?.events_created ?? 0;
      toast.success(n > 0 ? `${n} evento(s) detectado(s) automaticamente` : "Nenhum pico anômalo encontrado nos últimos 30 dias");
      qc.invalidateQueries({ queryKey: ["political-events"] });
    } catch (e: any) {
      toast.error(`Falha na detecção: ${e?.message || e}`);
    } finally {
      setDetecting(false);
    }
  };
  const [form, setForm] = useState({
    event_name: "",
    candidate_id: "",
    event_type: "entrevista",
    event_date: new Date().toISOString().slice(0, 16),
    description: "",
    location: "",
    city: "",
    state: "",
    keywords: "",
  });

  const { data: candidates } = useQuery({
    queryKey: ["pe-candidates", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase.from("candidates").select("id, full_name").eq("user_id", user.id).eq("status", "active");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const { data: events, isLoading } = useQuery({
    queryKey: ["political-events", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("political_events")
        .select("*, candidates:candidate_id(full_name)")
        .eq("user_id", user.id)
        .order("event_date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleCreate = async () => {
    if (!user || !form.event_name || !form.candidate_id) {
      toast.error("Preencha nome do evento e candidato");
      return;
    }
    const { error } = await supabase.from("political_events").insert({
      user_id: user.id,
      candidate_id: form.candidate_id,
      event_name: form.event_name,
      event_type: form.event_type,
      event_date: new Date(form.event_date).toISOString(),
      description: form.description || null,
      location: form.location || null,
      city: form.city || null,
      state: form.state || null,
      keywords: form.keywords ? form.keywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
    });
    if (error) {
      toast.error(`Erro: ${error.message}`);
      return;
    }
    toast.success("Evento criado!");
    setOpen(false);
    setForm({ ...form, event_name: "", description: "", location: "", city: "", state: "", keywords: "" });
    qc.invalidateQueries({ queryKey: ["political-events"] });
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Excluir este evento?")) return;
    const { error } = await supabase.from("political_events").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Evento excluído");
    qc.invalidateQueries({ queryKey: ["political-events"] });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Eventos & Entrevistas</h1>
          <p className="text-muted-foreground">Detectamos picos de menções automaticamente. Você também pode cadastrar eventos manualmente.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={handleAutoDetect} disabled={detecting}>
            {detecting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Detectar eventos com IA
          </Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />Novo evento</Button></DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Cadastrar evento político</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nome do evento *</Label>
                <Input value={form.event_name} onChange={(e) => setForm({ ...form, event_name: e.target.value })} placeholder="Ex.: Entrevista no Jornal Nacional" />
              </div>
              <div>
                <Label>Candidato *</Label>
                <Select value={form.candidate_id} onValueChange={(v) => setForm({ ...form, candidate_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {candidates?.map((c) => <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.event_type} onValueChange={(v) => setForm({ ...form, event_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data e hora</Label>
                  <Input type="datetime-local" value={form.event_date} onChange={(e) => setForm({ ...form, event_date: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Local (descrição)</Label>
                <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Ex.: Estúdio Globo" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Cidade</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
                <div><Label>UF</Label><Input maxLength={2} value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} /></div>
              </div>
              <div>
                <Label>Palavras-chave (separadas por vírgula)</Label>
                <Input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="economia, reforma, ..." />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate}>Cadastrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : !events || events.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-50" />
          Nenhum evento cadastrado. Crie o primeiro para medir o impacto nas redes.
        </Card>
      ) : (
        <div className="space-y-4">
          {events.map((ev: any) => (
            <EventImpactCard key={ev.id} event={ev} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventImpactCard({ event, onDelete }: { event: any; onDelete: (id: string) => void }) {
  const { user } = useAuth();
  const eventDate = new Date(event.event_date);
  const before = new Date(eventDate.getTime() - 48 * 3600_000);
  const during = new Date(eventDate.getTime() + 6 * 3600_000);
  const after = new Date(eventDate.getTime() + 54 * 3600_000);

  const { data: impact, isLoading } = useQuery({
    queryKey: ["event-impact", event.id, user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("social_interactions")
        .select("sentiment_label, sentiment_score, likes_count, original_posted_at, created_at")
        .eq("user_id", user.id)
        .eq("candidate_id", event.candidate_id)
        .gte("original_posted_at", before.toISOString())
        .lt("original_posted_at", after.toISOString())
        .limit(5000);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const stats = useMemo(() => {
    const buckets = { before: [] as any[], during: [] as any[], after: [] as any[] };
    impact?.forEach((i) => {
      const ts = new Date(i.original_posted_at || i.created_at || 0).getTime();
      if (ts < eventDate.getTime()) buckets.before.push(i);
      else if (ts < during.getTime()) buckets.during.push(i);
      else buckets.after.push(i);
    });
    const summarize = (arr: any[]) => {
      let pos = 0, neg = 0, neu = 0;
      arr.forEach((i) => {
        const l = (i.sentiment_label || "").toLowerCase();
        if (l.startsWith("pos")) pos++;
        else if (l.startsWith("neg")) neg++;
        else neu++;
      });
      const total = arr.length;
      const score = total > 0 ? Math.round(((pos * 100) + (neu * 50)) / total) : 0;
      return { total, pos, neg, neu, score };
    };
    return { before: summarize(buckets.before), during: summarize(buckets.during), after: summarize(buckets.after) };
  }, [impact, eventDate, during]);

  const delta = stats.after.score - stats.before.score;
  const volDelta = stats.after.total - stats.before.total;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h3 className="text-lg font-semibold">{event.event_name}</h3>
            <Badge variant="outline">{event.event_type}</Badge>
            {event.candidates?.full_name && <Badge variant="secondary">{event.candidates.full_name}</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">
            {format(eventDate, "dd 'de' MMMM yyyy, HH:mm", { locale: ptBR })}
            {event.location && ` • ${event.location}`}
            {event.city && ` • ${event.city}${event.state ? `/${event.state}` : ""}`}
          </p>
          {event.description && <p className="text-sm mt-2">{event.description}</p>}
        </div>
        <Button variant="ghost" size="icon" onClick={() => onDelete(event.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
      </div>

      {isLoading ? <Skeleton className="h-24 w-full" /> : (
        <div className="grid grid-cols-3 gap-3 mb-3">
          {(["before", "during", "after"] as const).map((k) => {
            const s = stats[k];
            const label = k === "before" ? "Antes (48h)" : k === "during" ? "Durante (6h)" : "Depois (48h)";
            return (
              <div key={k} className="p-3 rounded-lg bg-muted/40">
                <div className="text-xs text-muted-foreground mb-1">{label}</div>
                <div className="text-2xl font-bold">{s.total}</div>
                <div className="text-xs text-muted-foreground">menções</div>
                <div className="mt-2 flex gap-2 text-xs">
                  <span className="text-emerald-600">+{s.pos}</span>
                  <span className="text-rose-600">-{s.neg}</span>
                  <span className="text-muted-foreground">={s.neu}</span>
                </div>
                <div className="text-sm font-medium mt-1">Sent: {s.score}/100</div>
              </div>
            );
          })}
        </div>
      )}

      {!isLoading && (
        <div className="flex flex-wrap gap-3 text-sm pt-3 border-t">
          <div className="flex items-center gap-1">
            {delta > 5 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : delta < -5 ? <TrendingDown className="h-4 w-4 text-rose-600" /> : <Minus className="h-4 w-4 text-muted-foreground" />}
            <span className="font-medium">Sentimento:</span>
            <span className={delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : ""}>{delta > 0 ? "+" : ""}{delta} pts</span>
          </div>
          <div className="flex items-center gap-1">
            {volDelta > 0 ? <TrendingUp className="h-4 w-4 text-primary" /> : <TrendingDown className="h-4 w-4 text-muted-foreground" />}
            <span className="font-medium">Volume:</span>
            <span>{volDelta > 0 ? "+" : ""}{volDelta} menções</span>
          </div>
        </div>
      )}
    </Card>
  );
}
