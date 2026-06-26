import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAdminAudit } from "@/hooks/useAdminAudit";
import { Plus, Trash2, RefreshCw, Loader2, Landmark, Building2, Users2 } from "lucide-react";

const UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

const MUNICIPAL_CARGOS = ["prefeito", "vice_prefeito", "vereador"];
const NACIONAL_CARGOS = [
  "presidente", "vice_presidente",
  "governador", "vice_governador",
  "senador",
  "deputado_federal", "deputado_estadual", "deputado_distrital",
];

function TseSyncCard() {
  const qc = useQueryClient();
  const [uf, setUf] = useState<string>("");
  const [syncing, setSyncing] = useState<"municipal" | "nacional" | null>(null);

  const { data: counts, isLoading: loadingCounts } = useQuery({
    queryKey: ["politicians-counts"],
    queryFn: async () => {
      async function countFor(cargos: string[]) {
        const { count, error } = await supabase
          .from("politicians")
          .select("id", { count: "exact", head: true })
          .in("cargo", cargos);
        if (error) throw error;
        return count ?? 0;
      }
      async function countCargo(cargo: string) {
        const { count } = await supabase
          .from("politicians")
          .select("id", { count: "exact", head: true })
          .eq("cargo", cargo);
        return count ?? 0;
      }
      const [municipal, nacional, vereadores, prefeitos] = await Promise.all([
        countFor(MUNICIPAL_CARGOS),
        countFor(NACIONAL_CARGOS),
        countCargo("vereador"),
        countCargo("prefeito"),
      ]);
      return { municipal, nacional, vereadores, prefeitos };
    },
    refetchOnWindowFocus: false,
  });

  async function sync(kind: "municipal" | "nacional") {
    setSyncing(kind);
    try {
      const year = kind === "municipal" ? "2024" : "2022";
      const qs = new URLSearchParams({ year });
      if (uf) qs.set("uf", uf);
      const { data, error } = await supabase.functions.invoke(`etl-tse-politicians?${qs.toString()}`, {
        method: "POST",
      });
      if (error) throw error;
      const total = (data?.results ?? []).reduce((s: number, r: any) => s + (r.upserted ?? 0), 0);
      toast.success(
        `Base ${kind === "municipal" ? "municipal (2024)" : "nacional/estadual (2022)"} sincronizada — ${total.toLocaleString("pt-BR")} políticos atualizados.`,
      );
      qc.invalidateQueries({ queryKey: ["politicians-counts"] });
    } catch (e: any) {
      toast.error(`Falha na sincronização TSE: ${e.message ?? e}`);
    } finally {
      setSyncing(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5 text-primary" />
          Sincronizar bases TSE
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Vereadores
            </div>
            <div className="text-2xl font-bold">
              {loadingCounts ? "…" : (counts?.vereadores ?? 0).toLocaleString("pt-BR")}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users2 className="h-3.5 w-3.5" /> Prefeitos
            </div>
            <div className="text-2xl font-bold">
              {loadingCounts ? "…" : (counts?.prefeitos ?? 0).toLocaleString("pt-BR")}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Landmark className="h-3.5 w-3.5" /> Nacionais / Estaduais
            </div>
            <div className="text-2xl font-bold">
              {loadingCounts ? "…" : (counts?.nacional ?? 0).toLocaleString("pt-BR")}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">UF (vazio = todas)</Label>
            <select
              value={uf}
              onChange={(e) => setUf(e.target.value)}
              className="h-10 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Todas</option>
              {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <Button onClick={() => sync("municipal")} disabled={syncing !== null}>
            {syncing === "municipal" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Building2 className="h-4 w-4 mr-2" />}
            Sincronizar base municipal (2024)
          </Button>
          <Button onClick={() => sync("nacional")} disabled={syncing !== null} variant="secondary">
            {syncing === "nacional" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Landmark className="h-4 w-4 mr-2" />}
            Sincronizar base nacional (2022)
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          <strong>Municipal (2024):</strong> Prefeito, Vice-prefeito, Vereador. <br />
          <strong>Nacional/Estadual (2022):</strong> Presidente, Governador, Senador, Deputado Federal / Estadual / Distrital. <br />
          Os dois conjuntos convivem na tabela <code>politicians</code> e o catálogo faz UNION automaticamente quando "Todos os cargos" está selecionado. Para a primeira carga, prefira sincronizar UF por UF.
        </p>
      </CardContent>
    </Card>
  );
}

function Inner() {
  const qc = useQueryClient();
  const { log: audit } = useAdminAudit();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ full_name: "", party: "", region: "", category: "", social_media_link: "", description: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["admin-public-candidates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("public_candidates_catalog")
        .select("*")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = (data ?? []).filter((c: any) =>
    !search || [c.full_name, c.party, c.region, c.category].some((v) => v?.toLowerCase().includes(search.toLowerCase()))
  );

  async function create() {
    if (!form.full_name) return toast.error("Nome obrigatório");
    const { data: row, error } = await supabase.from("public_candidates_catalog").insert(form).select().single();
    if (error) return toast.error(error.message);
    toast.success("Candidato adicionado ao catálogo");
    await audit("public_candidate_created", "public_candidate", row.id, form);
    setOpen(false);
    setForm({ full_name: "", party: "", region: "", category: "", social_media_link: "", description: "" });
    qc.invalidateQueries({ queryKey: ["admin-public-candidates"] });
  }

  async function update(id: string, patch: any) {
    const { error } = await supabase.from("public_candidates_catalog").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await audit("public_candidate_updated", "public_candidate", id, patch);
    qc.invalidateQueries({ queryKey: ["admin-public-candidates"] });
  }

  async function remove(id: string) {
    if (!confirm("Remover este candidato do catálogo público?")) return;
    const { error } = await supabase.from("public_candidates_catalog").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido");
    await audit("public_candidate_deleted", "public_candidate", id);
    qc.invalidateQueries({ queryKey: ["admin-public-candidates"] });
  }

  return (
    <div className="space-y-4 p-6">
      <TseSyncCard />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Candidatos (Catálogo Público legado)</h1>
          <p className="text-muted-foreground">Catálogo manual antigo. A nova base nacional vem do pipeline TSE acima.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" /> Adicionar</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Novo candidato no catálogo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nome completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Partido</Label><Input value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} /></div>
                <div><Label>UF / Região</Label><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
              </div>
              <div><Label>Cargo / Categoria</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Presidente, Governador…" /></div>
              <div><Label>Link rede social</Label><Input value={form.social_media_link} onChange={(e) => setForm({ ...form, social_media_link: e.target.value })} /></div>
              <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={create}>Criar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Input placeholder="Buscar por nome, partido, UF…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />

      <Card>
        <CardHeader><CardTitle>{filtered.length} candidatos</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? <Skeleton className="h-64" /> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Partido</TableHead>
                  <TableHead>UF</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead>Ativo</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.full_name}</TableCell>
                    <TableCell><Input defaultValue={c.party ?? ""} onBlur={(e) => e.target.value !== c.party && update(c.id, { party: e.target.value })} className="h-8 w-24" /></TableCell>
                    <TableCell><Input defaultValue={c.region ?? ""} onBlur={(e) => e.target.value !== c.region && update(c.id, { region: e.target.value })} className="h-8 w-16" /></TableCell>
                    <TableCell><Input defaultValue={c.category ?? ""} onBlur={(e) => e.target.value !== c.category && update(c.id, { category: e.target.value })} className="h-8 w-32" /></TableCell>
                    <TableCell>
                      <Switch checked={c.is_active} onCheckedChange={(v) => update(c.id, { is_active: v })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!filtered.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhum candidato.</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">Editar Partido/UF/Cargo: clique no campo, edite e saia (blur) para salvar.</p>
    </div>
  );
}

export default function AdminCandidates() { return <AdminRoute><Inner /></AdminRoute>; }
