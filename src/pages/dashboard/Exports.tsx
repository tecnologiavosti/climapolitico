import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

type ExportJob = {
  id: string;
  resource: string;
  export_type: string;
  status: string;
  progress: number;
  rows_exported: number | null;
  download_url: string | null;
  download_expires_at: string | null;
  created_at: string;
  error_message: string | null;
};

export default function Exports() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [resource, setResource] = useState("social_interactions");
  const [type, setType] = useState<"csv" | "json">("csv");
  const [creating, setCreating] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  async function load() {
    if (!user) return;
    const { data } = await supabase.from("export_jobs").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(200);
    setJobs((data as ExportJob[]) || []);
  }

  useEffect(() => {
    load();
    if (!user) return;
    const ch = supabase
      .channel("exports-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "export_jobs", filter: `user_id=eq.${user.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const rowVirtualizer = useVirtualizer({
    count: jobs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 8,
  });

  async function createExport() {
    if (!user) return;
    setCreating(true);
    const { data, error } = await supabase.from("export_jobs").insert({
      user_id: user.id, resource, export_type: type, filters: {},
    }).select().single();
    if (error) { toast.error(error.message); setCreating(false); return; }
    await supabase.functions.invoke("export-worker").catch(() => null);
    toast.success("Exportação enfileirada");
    setCreating(false);
    load();
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Exportações</h1>
        <p className="text-sm text-muted-foreground">Geração assíncrona de exports com URL assinada (24h)</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Nova exportação</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Recurso</label>
            <Select value={resource} onValueChange={setResource}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="social_interactions">Interações sociais</SelectItem>
                <SelectItem value="candidates">Candidatos</SelectItem>
                <SelectItem value="candidate_analyses">Análises</SelectItem>
                <SelectItem value="candidate_rankings">Rankings</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Formato</label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={createExport} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Gerar exportação
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Histórico ({jobs.length})</CardTitle></CardHeader>
        <CardContent>
          <div ref={parentRef} className="h-[480px] overflow-auto border rounded-md">
            <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>
              {rowVirtualizer.getVirtualItems().map((vr) => {
                const j = jobs[vr.index];
                return (
                  <div key={j.id}
                    className="absolute top-0 left-0 w-full px-4 py-3 border-b flex items-center justify-between gap-3"
                    style={{ height: vr.size, transform: `translateY(${vr.start}px)` }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge variant={j.status === "succeeded" ? "default" : j.status === "failed" ? "destructive" : "secondary"}>{j.status}</Badge>
                        <span className="text-sm font-medium truncate">{j.resource} · {j.export_type.toUpperCase()}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {new Date(j.created_at).toLocaleString("pt-BR")}
                        {j.rows_exported != null && ` · ${j.rows_exported} linhas`}
                        {j.error_message && ` · ${j.error_message}`}
                      </div>
                    </div>
                    {j.download_url && j.status === "succeeded" && (
                      <Button asChild size="sm" variant="outline">
                        <a href={j.download_url} target="_blank" rel="noreferrer"><Download className="h-4 w-4 mr-1" />Baixar</a>
                      </Button>
                    )}
                  </div>
                );
              })}
              {jobs.length === 0 && <p className="p-6 text-sm text-muted-foreground">Nenhuma exportação ainda.</p>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
