import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import {
  Eye, EyeOff, Copy, Check, ShieldAlert, Key, Download,
  Loader2, Code2, Database, AlertTriangle, Info,
} from "lucide-react";

interface DbTable {
  tablename: string;
  row_count: number;
  column_count: number;
  encrypted_columns: number;
  has_user_id: boolean;
}

interface PanelData {
  project_url: string;
  anon_key: string;
  service_role_key: string;
  secrets: Record<string, string>;
  edge_functions: string[];
  edge_functions_count: number;
  database_tables: DbTable[];
}

function mask(v: string) {
  if (!v) return "";
  if (v.length <= 24) return v;
  return `${v.slice(0, 12)}•••••${v.slice(-8)}`;
}

function classifyTable(t: DbTable): { label: string; variant: "default" | "secondary" | "outline" } {
  const name = t.tablename.toLowerCase();
  if (name.includes("log") || name.includes("history") || name.includes("audit") || name.includes("event")) {
    return { label: "Histórico", variant: "secondary" };
  }
  if (t.row_count === 0 || name.includes("temp") || name.includes("cache")) {
    return { label: "Ignorar", variant: "outline" };
  }
  return { label: "Essencial", variant: "default" };
}

function SecretRow({ label, value }: { label: string; value: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: `${label} copiado` });
  };
  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-0">
      <span className="text-sm font-medium w-40 shrink-0">{label}</span>
      <code className="text-xs flex-1 bg-muted px-2 py-1 rounded truncate">
        {show ? value : mask(value)}
      </code>
      <Button variant="ghost" size="icon" onClick={() => setShow((s) => !s)}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={copy}>
        {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function StepCard({ n, icon, title, children }: { n: number; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className="text-muted-foreground">Passo {n}</span>
          <span className="text-muted-foreground">•</span>
          {icon}
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default function PainelMigracao() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PanelData | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const url = `https://${projectId}.supabase.co/functions/v1/painel-migracao`;
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as PanelData;
      setData(json);
      toast({ title: "Dados carregados", description: `${json.edge_functions_count} funções, ${Array.isArray(json.database_tables) ? json.database_tables.length : 0} tabelas.` });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const copyAll = async () => {
    if (!data) return;
    const secretsBlock = Object.entries(data.secrets).map(([k, v]) => `${k}=${v}`).join("\n");
    const text = [
      "═══ CREDENCIAIS ═══",
      `PROJECT_URL=${data.project_url}`,
      `ANON_KEY=${data.anon_key}`,
      `SERVICE_ROLE_KEY=${data.service_role_key}`,
      "",
      "═══ EDGE FUNCTIONS ═══",
      data.edge_functions.join("\n"),
      "",
      "═══ SECRETS ═══",
      secretsBlock,
    ].join("\n");
    await navigator.clipboard.writeText(text);
    toast({ title: "Tudo copiado para a área de transferência" });
  };

  const downloadEdgeFunctions = () => {
    const modules = import.meta.glob("/supabase/functions/*/index.ts", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const parts: string[] = [];
    for (const [path, code] of Object.entries(modules)) {
      const name = path.split("/").slice(-2, -1)[0];
      parts.push(`// ═══ ${name} ═══\n${code}\n`);
    }
    const blob = new Blob([parts.join("\n")], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "edge-functions.ts";
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: `${Object.keys(modules).length} funções exportadas` });
  };

  const downloadSecrets = () => {
    if (!data) return;
    const entries = Object.entries(data.secrets)
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
      .join("\n");
    const code = `export const SECRETS = {\n${entries}\n} as const;\n\nexport type SecretKey = keyof typeof SECRETS;\n`;
    const blob = new Blob([code], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "secrets.ts";
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "secrets.ts baixado" });
  };

  const copyOne = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value);
    toast({ title: `${label} copiado` });
  };

  const tables = Array.isArray(data?.database_tables) ? (data!.database_tables as DbTable[]) : [];

  return (
    <div className="min-h-screen bg-background p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold">Painel de Migração</h1>
          <p className="text-muted-foreground">
            Copie os itens abaixo na ordem e cole na extensão CloneSupa.
          </p>
        </header>

        <div className="flex flex-wrap gap-2">
          <Button onClick={load} disabled={loading} size="lg">
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Eye className="h-4 w-4 mr-2" />}
            Revelar Tudo
          </Button>
          <Button variant="outline" onClick={copyAll} disabled={!data}>
            <Copy className="h-4 w-4 mr-2" /> Copiar Tudo
          </Button>
        </div>

        {data && (
          <>
            <StepCard n={1} icon={<ShieldAlert className="h-5 w-5" />} title="Credenciais">
              <SecretRow label="Project URL" value={data.project_url} />
              <SecretRow label="Anon Key" value={data.anon_key} />
              <SecretRow label="Service Role Key" value={data.service_role_key} />
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={() => copyOne("Project URL", data.project_url)}>
                  <Copy className="h-4 w-4 mr-2" /> Copiar Project URL
                </Button>
                <Button size="sm" onClick={() => copyOne("Service Role Key", data.service_role_key)}>
                  <Copy className="h-4 w-4 mr-2" /> Copiar Service Role Key
                </Button>
              </div>
            </StepCard>

            <StepCard n={2} icon={<Code2 className="h-5 w-5" />} title={`Edge Functions (${data.edge_functions_count})`}>
              <div className="flex flex-wrap gap-1.5 mb-4">
                {data.edge_functions.map((n) => (
                  <Badge key={n} variant="secondary">{n}</Badge>
                ))}
              </div>
              <Button onClick={downloadEdgeFunctions}>
                <Download className="h-4 w-4 mr-2" /> Baixar edge-functions.ts
              </Button>
            </StepCard>

            <StepCard n={3} icon={<Key className="h-5 w-5" />} title={`Secrets (${Object.keys(data.secrets).length})`}>
              <div className="space-y-1 mb-4">
                {Object.entries(data.secrets).map(([k, v]) => (
                  <SecretRow key={k} label={k} value={v} />
                ))}
              </div>
              <Button onClick={downloadSecrets}>
                <Download className="h-4 w-4 mr-2" /> Baixar secrets.ts
              </Button>
            </StepCard>

            <StepCard n={4} icon={<Database className="h-5 w-5" />} title={`Conferência — ${tables.length} tabelas`}>
              <div className="rounded-md border p-3 mb-4 flex gap-2 items-start bg-amber-500/10">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="text-xs">
                  Senhas são copiadas como hash bcrypt. Se o JWT secret do destino mudar, sessões antigas caem — mas a senha continua válida.
                </p>
              </div>
              <div className="rounded-md border p-3 mb-4 flex gap-2 items-start">
                <Info className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  Classificação heurística. Confira antes de importar no destino.
                </p>
              </div>
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {tables.map((t) => {
                  const cls = classifyTable(t);
                  return (
                    <div key={t.tablename} className="flex items-center gap-2 py-1 border-b last:border-0 text-sm">
                      <Badge variant={cls.variant} className="w-20 justify-center shrink-0">{cls.label}</Badge>
                      <span className="font-mono flex-1 truncate">{t.tablename}</span>
                      <span className="text-xs text-muted-foreground">{t.row_count} linhas • {t.column_count} cols</span>
                      {t.encrypted_columns > 0 && <Badge variant="outline">🔒 {t.encrypted_columns}</Badge>}
                      {t.has_user_id && <Badge variant="outline">user_id</Badge>}
                    </div>
                  );
                })}
              </div>
            </StepCard>
          </>
        )}
      </div>
    </div>
  );
}
