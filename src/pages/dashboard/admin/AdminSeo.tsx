import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Plus, Save, Trash2 } from "lucide-react";
import { useAdminAudit } from "@/hooks/useAdminAudit";

type Seo = {
  id: string;
  route: string;
  title: string | null;
  description: string | null;
  keywords: string | null;
  og_image: string | null;
  og_title: string | null;
  og_description: string | null;
  canonical_url: string | null;
  noindex: boolean;
};

function SeoCard({ row, onSave, onDelete }: { row: Seo; onSave: (s: Seo) => void; onDelete: (id: string) => void }) {
  const [d, setD] = useState<Seo>(row);
  const u = (patch: Partial<Seo>) => setD(s => ({ ...s, ...patch }));
  const len = (s: string | null | undefined) => (s ?? "").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <code className="text-sm">{d.route}</code>
          {d.noindex && <span className="text-xs text-destructive">noindex</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div><Label>Rota</Label><Input value={d.route} onChange={e => u({ route: e.target.value })} /></div>
        <div>
          <Label>Title <span className="text-xs text-muted-foreground">({len(d.title)}/60)</span></Label>
          <Input value={d.title ?? ""} onChange={e => u({ title: e.target.value })} />
        </div>
        <div>
          <Label>Description <span className="text-xs text-muted-foreground">({len(d.description)}/160)</span></Label>
          <Textarea rows={2} value={d.description ?? ""} onChange={e => u({ description: e.target.value })} />
        </div>
        <div><Label>Keywords</Label><Input value={d.keywords ?? ""} onChange={e => u({ keywords: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><Label>OG Title</Label><Input value={d.og_title ?? ""} onChange={e => u({ og_title: e.target.value })} /></div>
          <div><Label>OG Image (URL)</Label><Input value={d.og_image ?? ""} onChange={e => u({ og_image: e.target.value })} /></div>
        </div>
        <div><Label>OG Description</Label><Textarea rows={2} value={d.og_description ?? ""} onChange={e => u({ og_description: e.target.value })} /></div>
        <div><Label>Canonical URL</Label><Input value={d.canonical_url ?? ""} onChange={e => u({ canonical_url: e.target.value })} /></div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Switch checked={d.noindex} onCheckedChange={v => u({ noindex: v })} />
            <span className="text-sm">noindex (não indexar)</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onDelete(row.id)}><Trash2 className="h-3 w-3" /></Button>
            <Button size="sm" onClick={() => onSave(d)}><Save className="h-3 w-3 mr-1" /> Salvar</Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { log } = useAdminAudit();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-seo"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seo_settings").select("*").order("route");
      if (error) throw error;
      return data as Seo[];
    },
  });

  const save = useMutation({
    mutationFn: async (s: Seo) => {
      const { error } = await supabase.from("seo_settings").update({
        route: s.route, title: s.title, description: s.description, keywords: s.keywords,
        og_image: s.og_image, og_title: s.og_title, og_description: s.og_description,
        canonical_url: s.canonical_url, noindex: s.noindex,
      }).eq("id", s.id);
      if (error) throw error;
      await log("seo_updated", "seo_setting", s.id, { route: s.route });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-seo"] }); toast({ title: "SEO salvo" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("seo_settings").delete().eq("id", id);
      if (error) throw error;
      await log("seo_deleted", "seo_setting", id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-seo"] }); toast({ title: "Removido" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("seo_settings").insert({
        route: `/nova-${Date.now()}`, title: "", description: "",
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-seo"] }); toast({ title: "Rota criada" }); },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">SEO</h1>
          <p className="text-sm text-muted-foreground">Configure title, description e Open Graph por rota.</p>
        </div>
        <Button onClick={() => create.mutate()}><Plus className="h-4 w-4 mr-1" /> Nova rota</Button>
      </div>
      {isLoading ? <Skeleton className="h-64" /> : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data?.map(r => <SeoCard key={r.id} row={r} onSave={save.mutate} onDelete={del.mutate} />)}
        </div>
      )}
    </div>
  );
}

export default function AdminSeo() { return <AdminRoute><Inner /></AdminRoute>; }
