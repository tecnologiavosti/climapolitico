import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Webhook, Trash2, Plus } from "lucide-react";

interface Endpoint {
  id: string; name: string; url: string; events: string[];
  is_active: boolean; consecutive_failures: number;
  last_success_at: string | null; last_failure_at: string | null;
}

const EVENT_OPTIONS = ["analysis.completed", "export.completed", "candidate.updated", "alert.triggered"];

export default function WebhooksPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["analysis.completed"]);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("webhook_endpoints" as any)
      .select("id,name,url,events,is_active,consecutive_failures,last_success_at,last_failure_at")
      .order("created_at", { ascending: false });
    setRows((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!user || !name || !url) return;
    setCreating(true);
    const secret = "whsec_" + crypto.getRandomValues(new Uint8Array(24))
      .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
    const { error } = await supabase.from("webhook_endpoints" as any).insert({
      user_id: user.id, name, url, events, secret,
    });
    setCreating(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Webhook criado", { description: `Segredo: ${secret}` });
    setName(""); setUrl("");
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este webhook?")) return;
    await supabase.from("webhook_endpoints" as any).delete().eq("id", id);
    load();
  };

  const toggleEvent = (e: string) => {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Webhook className="h-6 w-6" />Webhooks</h1>
        <p className="text-muted-foreground text-sm">Receba notificações de eventos da plataforma em sua URL.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" />Novo endpoint</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Nome (ex: Slack alerts)" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="https://exemplo.com/webhook" value={url} onChange={e => setUrl(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {EVENT_OPTIONS.map(e => (
              <Badge key={e} variant={events.includes(e) ? "default" : "outline"}
                className="cursor-pointer" onClick={() => toggleEvent(e)}>{e}</Badge>
            ))}
          </div>
          <Button onClick={create} disabled={creating || !name || !url}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}Criar webhook
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Endpoints ativos</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum webhook configurado.</p>
          ) : (
            <div className="space-y-2">
              {rows.map(r => (
                <div key={r.id} className="flex items-start justify-between p-3 rounded-lg border">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2">
                      {r.name}
                      <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "ativo" : "inativo"}</Badge>
                      {r.consecutive_failures > 0 && (
                        <Badge variant="destructive">{r.consecutive_failures} falhas</Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{r.url}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {r.events.map(e => <Badge key={e} variant="outline" className="text-[10px]">{e}</Badge>)}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => remove(r.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
