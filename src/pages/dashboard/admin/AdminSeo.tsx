import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

function Inner() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-3xl font-bold">SEO</h1>
      <Alert><Info className="h-4 w-4" /><AlertDescription>Editor de SEO (title, description, Open Graph, sitemap, robots) será disponibilizado na Fase 2 com a tabela <code>seo_settings</code>.</AlertDescription></Alert>
      <Card>
        <CardHeader><CardTitle>Arquivos atuais</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-1">
          <p>• <code>index.html</code> — meta tags principais</p>
          <p>• <code>public/robots.txt</code></p>
          <p>• <code>public/sitemap.xml</code></p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSeo() { return <AdminRoute><Inner /></AdminRoute>; }
