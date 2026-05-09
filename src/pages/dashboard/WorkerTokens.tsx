import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, Copy, KeyRound } from "lucide-react";

interface TokenRow {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

export default function WorkerTokensPage() {
  const { isAdmin, isLoading: adminLoading } = useAdminCheck();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [expiresDays, setExpiresDays] = useState<number | "">("");
  const [creating, setCreating] = useState(false);
  const [newPlaintext, setNewPlaintext] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("worker_api_tokens" as any)
      .select("id,name,token_prefix,scopes,created_at,last_used_at,expires_at,revoked_at")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setTokens((data as any) || []);
    setLoading(false);
  }, []);

  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  const create = async () => {
    if (!name.trim()) return toast.error("Informe um nome");
    setCreating(true);
    const { data, error } = await supabase.rpc("create_worker_token" as any, {
      _name: name.trim(),
      _scopes: ["worker:claim", "worker:complete"],
      _expires_days: expiresDays === "" ? null : Number(expiresDays),
    });
    setCreating(false);
    if (error) return toast.error(error.message);
    const result = data as { token: string };
    setNewPlaintext(result.token);
    setName("");
    setExpiresDays("");
    load();
  };

  const revoke = async (id: string) => {
    if (!confirm("Revogar este token? Workers usando ele perderão acesso imediatamente.")) return;
    const { error } = await supabase
      .from("worker_api_tokens" as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Token revogado"); load(); }
  };

  const copyToken = () => {
    if (!newPlaintext) return;
    navigator.clipboard.writeText(newPlaintext);
    toast.success("Token copiado!");
  };

  if (adminLoading) return <div className="p-6"><Loader2 className="animate-spin" /></div>;
  if (!isAdmin) return <div className="p-6 text-muted-foreground">Acesso restrito a administradores.</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="h-6 w-6" />Worker API Tokens</h1>
        <p className="text-muted-foreground text-sm">Tokens para workers externos (Docker/Railway) consumirem a fila.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Criar novo token</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Input placeholder="Nome (ex: railway-worker-1)" value={name} onChange={(e) => setName(e.target.value)} />
            <Input
              type="number"
              placeholder="Expira em N dias (vazio = nunca)"
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value === "" ? "" : Number(e.target.value))}
            />
            <Button onClick={create} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="h-4 w-4 mr-2" />Gerar</>}
            </Button>
          </div>

          {newPlaintext && (
            <div className="p-3 rounded-lg border border-primary bg-primary/5 space-y-2">
              <p className="text-sm font-medium">⚠️ Copie agora — este token não será mostrado novamente:</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-background rounded text-xs break-all">{newPlaintext}</code>
                <Button size="sm" variant="outline" onClick={copyToken}><Copy className="h-4 w-4" /></Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setNewPlaintext(null)}>Fechar</Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Tokens ativos</CardTitle></CardHeader>
        <CardContent>
          {loading ? <Loader2 className="animate-spin" /> : tokens.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum token gerado ainda.</p>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.name}</span>
                      {t.revoked_at && <Badge variant="destructive">Revogado</Badge>}
                      {!t.revoked_at && t.expires_at && new Date(t.expires_at) < new Date() && <Badge variant="destructive">Expirado</Badge>}
                      {!t.revoked_at && (!t.expires_at || new Date(t.expires_at) > new Date()) && <Badge variant="secondary">Ativo</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{t.token_prefix}…</div>
                    <div className="text-xs text-muted-foreground">
                      Criado: {new Date(t.created_at).toLocaleDateString("pt-BR")} · Último uso: {t.last_used_at ? new Date(t.last_used_at).toLocaleString("pt-BR") : "nunca"}
                      {t.expires_at && ` · Expira: ${new Date(t.expires_at).toLocaleDateString("pt-BR")}`}
                    </div>
                  </div>
                  {!t.revoked_at && (
                    <Button size="sm" variant="ghost" onClick={() => revoke(t.id)}>
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
        <CardHeader><CardTitle>Como usar (worker externo)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Endpoint base: <code className="bg-muted px-1 rounded">POST {`{SUPABASE_URL}`}/functions/v1/external-worker-api/&lt;action&gt;</code></p>
          <p>Headers: <code className="bg-muted px-1 rounded">Authorization: Bearer wkr_...</code></p>
          <p>Actions: <code>claim</code>, <code>complete</code>, <code>heartbeat</code></p>
        </CardContent>
      </Card>
    </div>
  );
}
