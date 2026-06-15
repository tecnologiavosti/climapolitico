import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export function BlogIASection() {
  const { data: posts, isLoading } = useQuery({
    queryKey: ["blog-posts-public"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("id, title, slug, excerpt, cover_image, created_at, tags")
        .eq("published", true)
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) throw error;
      return data || [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Blog IA
          </CardTitle>
          <CardDescription>Conteúdo gerado automaticamente para o site</CardDescription>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard/admin/blog">Ver todos os posts <ArrowRight className="ml-1 h-4 w-4" /></Link>
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">{[1,2,3].map(i => <Skeleton key={i} className="h-48 w-full" />)}</div>
        ) : !posts?.length ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-muted-foreground">Nenhum artigo publicado ainda.</p>
            <Button asChild variant="outline" size="sm">
              <Link to="/dashboard/admin/blog">Ir para Blog</Link>
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            {posts.map((p) => (
              <Card key={p.id} className="overflow-hidden flex flex-col">
                {p.cover_image && <img src={p.cover_image} alt={p.title} className="w-full h-32 object-cover" />}
                <CardContent className="p-4 flex-1 flex flex-col gap-2">
                  <h3 className="font-semibold leading-tight line-clamp-2">{p.title}</h3>
                  {p.excerpt && <p className="text-sm text-muted-foreground line-clamp-3">{p.excerpt}</p>}
                  <div className="flex flex-wrap gap-1">
                    {p.tags?.slice(0, 3).map((t: string) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-auto pt-2">
                    {format(new Date(p.created_at), "dd 'de' MMM yyyy", { locale: ptBR })}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
