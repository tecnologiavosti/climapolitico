import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Copy, KeyRound } from "lucide-react";

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_per_minute: number;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const API_BASE = `https://${PROJECT_ID}.supabase.co/functions/v1/public-api-v1/v1`;

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [expiresDays, setExpiresDays] = useState<number | "">("");
  const [rateLimit, setRateLimit] = useState<number>(60);
  const [creating, setCreating] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("api_keys" as any)
      .select("id,name,key_prefix,scopes,rate_limit_per_minute,created_at,last_used_at,expires_at,revoked_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setKeys((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!name.trim()) return toast.error("Informe um nome");
    setCreating(true);
    const { data, error } = await supabase.rpc("create_api_key" as any, {
      _name: name.trim(),
      _scopes: ["read:candidates", "read:analyses", "read:usage"],
      _expires_days: expiresDays === "" ? null : Number(expiresDays),
      _rate_limit_per_minute: rateLimit,
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    setNewPlaintext((data as any).token);
    setName("");
    setExpiresDays("");
    load();
  };

  const revoke = async (id: string) => {
    if (!confirm("Revogar esta chave? Integrações que a utilizam pararão de funcionar imediatamente.")) return;
    const { error } = await supabase
      .from("api_keys" as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Chave revogada"); load(); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="h-6 w-6" />Chaves de API (v1)</h1>
        <p className="text-muted-foreground text-sm">
          Gere chaves para consumir a API pública e integrar com BI, automações ou aplicações próprias.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Criar nova chave</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Input placeholder="Nome (ex: bi-metabase)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              type="number"
              placeholder="Expira em N dias"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value === "" ? "" : Number(e.target.value))}
            />
            <Input
              type="number"
              min={1}
              max={6000}
              placeholder="req/min"
              value={rateLimit}
              onChange={(e) => setRateLimit(Number(e.target.value) || 60)}
            />
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" />Gerar</>}
            </Button>
          </div>

          {newPlaintext && (
            <div className="p-3 rounded-lg border border-primary bg-primary/5 space-y-2">
              <p className="text-sm font-medium">⚠️ Copie agora — esta chave não será mostrada novamente:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-background rounded text-xs break-all">{newPlaintext}</code>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(newPlaintext); toast.success("Copiado!"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNewPlaintext(null)}>Fechar</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Chaves ativas</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhuma chave gerada ainda.</p>
          ) : (
            <div className="space-y-2">
              {keys.map((k) => (
                <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{k.name}</span>
                      {k.revoked_at && <Badge variant="destructive">Revogada</Badge>}
                      {!k.revoked_at && k.expires_at && new Date(k.expires_at) < new Date() && <Badge variant="destructive">Expirada</Badge>}
                      {!k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date()) && <Badge variant="secondary">Ativa</Badge>}
                      <Badge variant="outline">{k.rate_limit_per_minute} req/min</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</div>
                    <div className="text-xs text-muted-foreground">
                      Escopos: {k.scopes.join(", ")} · Último uso: {k.last_used_at ? new Date(k.last_used_at).toLocaleString("pt-BR") : "nunca"}
                    </div>
                  </div>
                  {!k.revoked_at && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(k.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Como usar</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Endpoint base: <code className="bg-muted px-1 rounded break-all">{API_BASE}</code></p>
          <p>Header: <code className="bg-muted px-1 rounded">Authorization: Bearer pk_live_...</code></p>
          <p>Endpoints disponíveis:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><code>GET /v1/candidates?limit=50&offset=0</code></li>
            <li><code>GET /v1/candidates/{`{id}`}</code></li>
            <li><code>GET /v1/analyses?limit=50</code></li>
            <li><code>GET /v1/ranking</code></li>
            <li><code>GET /v1/usage?days=30</code></li>
          </ul>
          <p className="text-muted-foreground">
            Toda chamada conta como 1 evento <code>api_request</code> em <strong>Meu Consumo</strong> e respeita o limite por minuto da chave.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
