import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminCheck } from "@/hooks/useAdminCheck";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Shield, Sparkles, Trash2, EyeOff, Eye, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  cover_image: string | null;
  tags: string[];
  published: boolean;
  created_at: string;
};

export default function BlogAdmin() {
  const { isAdmin, isLoading: checkingAdmin } = useAdminCheck();
  const qc = useQueryClient();
  const [theme, setTheme] = useState("");
  const [subtheme, setSubtheme] = useState("");
  const [count, setCount] = useState(1);
  const [generating, setGenerating] = useState(false);

  useQuery({
    queryKey: ["blog-settings"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data } = await supabase.from("blog_settings").select("*").eq("id", 1).maybeSingle();
      if (data) {
        setTheme(data.theme || "");
        setSubtheme(data.subtheme || "");
      }
      return data;
    },
  });

  const { data: posts, isLoading: loadingPosts } = useQuery({
    queryKey: ["blog-posts-admin"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as BlogPost[];
    },
  });

  const saveSettings = async () => {
    const { error } = await supabase
      .from("blog_settings")
      .upsert({ id: 1, theme, subtheme, updated_at: new Date().toISOString() });
    if (error) toast.error("Erro ao salvar tema: " + error.message);
    else toast.success("Tema salvo");
  };

  const generate = async () => {
    if (!theme.trim()) {
      toast.error("Informe o tema do site antes de gerar");
      return;
    }
    setGenerating(true);
    try {
      await supabase
        .from("blog_settings")
        .upsert({ id: 1, theme, subtheme, updated_at: new Date().toISOString() });
      const { data, error } = await supabase.functions.invoke("generate-blog-posts", {
        body: { theme, subtheme, count },
      });
      if (error) throw error;
      const created = data?.created?.length ?? 0;
      const errs = data?.errors?.length ?? 0;
      if (created > 0) toast.success(`${created} post(s) gerado(s) com sucesso`);
      if (errs > 0) toast.warning(`${errs} falha(s) durante a geração`);
      qc.invalidateQueries({ queryKey: ["blog-posts-admin"] });
      qc.invalidateQueries({ queryKey: ["blog-posts-public"] });
    } catch (e: any) {
      toast.error("Erro ao gerar posts: " + (e.message || e));
    } finally {
      setGenerating(false);
    }
  };

  const togglePublish = useMutation({
    mutationFn: async (p: BlogPost) => {
      const { error } = await supabase.from("blog_posts").update({ published: !p.published }).eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blog-posts-admin"] });
      qc.invalidateQueries({ queryKey: ["blog-posts-public"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("blog_posts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Post excluído");
      qc.invalidateQueries({ queryKey: ["blog-posts-admin"] });
      qc.invalidateQueries({ queryKey: ["blog-posts-public"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (checkingAdmin) {
    return <div className="p-6"><Skeleton className="h-8 w-48" /></div>;
  }
  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Shield className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-2xl font-bold">Acesso Negado</h2>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileText className="h-8 w-8" /> Blog IA
        </h1>
        <p className="text-muted-foreground mt-2">
          Gere artigos automaticamente com IA e gerencie os posts publicados
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuração & Geração</CardTitle>
          <CardDescription>Defina o tema do site e gere novos posts</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Tema do site</Label>
              <Input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="Ex: política brasileira, moda, tecnologia" />
            </div>
            <div className="space-y-2">
              <Label>Sub-tema (opcional)</Label>
              <Input value={subtheme} onChange={(e) => setSubtheme(e.target.value)} placeholder="Ex: eleições 2026" />
            </div>
            <div className="space-y-2">
              <Label>Quantidade</Label>
              <Input type="number" min={1} max={5} value={count} onChange={(e) => setCount(Math.min(5, Math.max(1, Number(e.target.value) || 1)))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={saveSettings}>Salvar tema</Button>
            <Button onClick={generate} disabled={generating}>
              {generating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Gerando...</> : <><Sparkles className="mr-2 h-4 w-4" /> Gerar agora</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Posts</CardTitle>
          <CardDescription>{posts?.length ?? 0} post(s) no total</CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPosts ? (
            <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : !posts?.length ? (
            <p className="text-center text-muted-foreground py-12">Nenhum post ainda. Use "Gerar agora" acima para criar o primeiro.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => (
                <Card key={p.id} className="overflow-hidden flex flex-col">
                  {p.cover_image && (
                    <img src={p.cover_image} alt={p.title} className="w-full h-40 object-cover" />
                  )}
                  <CardContent className="p-4 flex-1 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold leading-tight line-clamp-2">{p.title}</h3>
                      {!p.published && <Badge variant="secondary">Rascunho</Badge>}
                    </div>
                    {p.excerpt && <p className="text-sm text-muted-foreground line-clamp-3">{p.excerpt}</p>}
                    <div className="flex flex-wrap gap-1">
                      {p.tags?.slice(0, 4).map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                    </div>
                    <p className="text-xs text-muted-foreground mt-auto">
                      {format(new Date(p.created_at), "dd 'de' MMM yyyy", { locale: ptBR })}
                    </p>
                    <div className="flex gap-2 pt-2">
                      <Button size="sm" variant="outline" onClick={() => togglePublish.mutate(p)}>
                        {p.published ? <><EyeOff className="h-3 w-3 mr-1" /> Despublicar</> : <><Eye className="h-3 w-3 mr-1" /> Publicar</>}
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => { if (confirm("Excluir este post?")) remove.mutate(p.id); }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
