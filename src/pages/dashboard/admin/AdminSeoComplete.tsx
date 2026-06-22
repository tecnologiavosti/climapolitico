import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Plus, Save, Trash2, Download, RefreshCw, CheckCircle2, XCircle, Globe, ShieldCheck, Activity, FileCode } from "lucide-react";

const SITE_URL = "https://climapolitico.com.br";

const VERIFICATION_PROVIDERS = [
  { key: "google", label: "Google Search Console", help: "Cole o valor do meta tag (apenas o content)." },
  { key: "bing", label: "Bing Webmaster", help: "Valor do msvalidate.01." },
  { key: "yandex", label: "Yandex", help: "Valor do yandex-verification." },
  { key: "pinterest", label: "Pinterest", help: "Valor do p:domain_verify." },
  { key: "facebook", label: "Facebook Domain", help: "Valor do facebook-domain-verification." },
];

const TRACKING_PROVIDERS = [
  { key: "google_analytics", label: "Google Analytics 4", placeholder: "G-XXXXXXXXXX" },
  { key: "google_tag_manager", label: "Google Tag Manager", placeholder: "GTM-XXXXXXX" },
  { key: "facebook_pixel", label: "Meta Pixel (Facebook)", placeholder: "1234567890123456" },
  { key: "tiktok_pixel", label: "TikTok Pixel", placeholder: "CXXXXXXXXXXXX" },
  { key: "linkedin_insight", label: "LinkedIn Insight Tag", placeholder: "1234567" },
  { key: "hotjar", label: "Hotjar", placeholder: "1234567" },
  { key: "clarity", label: "Microsoft Clarity", placeholder: "abcdefghij" },
];

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
  const u = (patch: Partial<Seo>) => setD((s) => ({ ...s, ...patch }));
  const len = (s: string | null | undefined) => (s ?? "").length;
  const titleOk = len(d.title) > 0 && len(d.title) <= 60;
  const descOk = len(d.description) >= 50 && len(d.description) <= 160;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <code>{d.route}</code>
          <div className="flex items-center gap-1">
            {d.noindex && <Badge variant="destructive">noindex</Badge>}
            {titleOk && descOk ? <Badge variant="secondary">OK</Badge> : <Badge variant="outline">Pendente</Badge>}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label>Rota</Label>
          <Input value={d.route} onChange={(e) => u({ route: e.target.value })} />
        </div>
        <div>
          <Label>
            Title{" "}
            <span className={`text-xs ${titleOk ? "text-muted-foreground" : "text-destructive"}`}>
              ({len(d.title)}/60)
            </span>
          </Label>
          <Input value={d.title ?? ""} onChange={(e) => u({ title: e.target.value })} />
        </div>
        <div>
          <Label>
            Description{" "}
            <span className={`text-xs ${descOk ? "text-muted-foreground" : "text-destructive"}`}>
              ({len(d.description)}/160)
            </span>
          </Label>
          <Textarea rows={2} value={d.description ?? ""} onChange={(e) => u({ description: e.target.value })} />
        </div>
        <div>
          <Label>Keywords</Label>
          <Input value={d.keywords ?? ""} onChange={(e) => u({ keywords: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>OG Title</Label>
            <Input value={d.og_title ?? ""} onChange={(e) => u({ og_title: e.target.value })} />
          </div>
          <div>
            <Label>OG Image (URL)</Label>
            <Input value={d.og_image ?? ""} onChange={(e) => u({ og_image: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>OG Description</Label>
          <Textarea rows={2} value={d.og_description ?? ""} onChange={(e) => u({ og_description: e.target.value })} />
        </div>
        <div>
          <Label>Canonical URL</Label>
          <Input value={d.canonical_url ?? ""} onChange={(e) => u({ canonical_url: e.target.value })} />
        </div>

        {/* SERP Preview */}
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Pré-visualização Google</div>
          <div className="text-xs text-muted-foreground truncate">{SITE_URL}{d.route}</div>
          <div className="text-base text-primary font-medium truncate">{d.title || "(Sem title)"}</div>
          <div className="text-xs text-foreground/80 line-clamp-2">{d.description || "(Sem description)"}</div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            <Switch checked={d.noindex} onCheckedChange={(v) => u({ noindex: v })} />
            <span className="text-sm">noindex (não indexar)</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onDelete(row.id)}>
              <Trash2 className="h-3 w-3" />
            </Button>
            <Button size="sm" onClick={() => onSave(d)}>
              <Save className="h-3 w-3 mr-1" /> Salvar
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MetaTagsSection() {
  const qc = useQueryClient();
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
      const { error } = await supabase
        .from("seo_settings")
        .update({
          route: s.route,
          title: s.title,
          description: s.description,
          keywords: s.keywords,
          og_image: s.og_image,
          og_title: s.og_title,
          og_description: s.og_description,
          canonical_url: s.canonical_url,
          noindex: s.noindex,
        })
        .eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-seo"] });
      toast({ title: "SEO salvo" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("seo_settings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-seo"] });
      toast({ title: "Removido" });
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("seo_settings").insert({
        route: `/nova-${Date.now()}`,
        title: "",
        description: "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-seo"] });
      toast({ title: "Rota criada" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Meta Tags por Rota</h2>
          <p className="text-sm text-muted-foreground">Title, description, Open Graph e canonical por página.</p>
        </div>
        <Button onClick={() => create.mutate()}>
          <Plus className="h-4 w-4 mr-1" /> Nova rota
        </Button>
      </div>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data?.map((r) => <SeoCard key={r.id} row={r} onSave={save.mutate} onDelete={del.mutate} />)}
        </div>
      )}
    </div>
  );
}

function VerificationsSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["seo-verifications-admin"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("seo_verifications").select("*");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const [vals, setVals] = useState<Record<string, string>>({});
  const getVal = (key: string) =>
    vals[key] ?? data?.find((r: any) => r.provider === key)?.code ?? "";

  const upsert = useMutation({
    mutationFn: async ({ provider, code }: { provider: string; code: string }) => {
      const { error } = await (supabase as any)
        .from("seo_verifications")
        .upsert({ provider, code, updated_at: new Date().toISOString() }, { onConflict: "provider" });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-verifications-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-verifications"] });
      toast({ title: "Verificação salva" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (provider: string) => {
      const { error } = await (supabase as any).from("seo_verifications").delete().eq("provider", provider);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-verifications-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-verifications"] });
      toast({ title: "Removido" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Códigos de Verificação</h2>
        <p className="text-sm text-muted-foreground">
          Confirme a propriedade do site nos buscadores. Cole apenas o valor do <code>content</code> da meta tag.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {VERIFICATION_PROVIDERS.map((p) => {
          const current = data?.find((r: any) => r.provider === p.key);
          return (
            <Card key={p.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {p.label}
                  {current && <Badge variant="secondary">Ativo</Badge>}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{p.help}</p>
                <Input
                  value={getVal(p.key)}
                  placeholder="Cole aqui o código"
                  onChange={(e) => setVals((s) => ({ ...s, [p.key]: e.target.value }))}
                />
                <div className="flex gap-2 justify-end">
                  {current && (
                    <Button variant="outline" size="sm" onClick={() => remove.mutate(p.key)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={() => {
                      const code = getVal(p.key).trim();
                      if (!code) return;
                      upsert.mutate({ provider: p.key, code });
                    }}
                  >
                    <Save className="h-3 w-3 mr-1" /> Salvar
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TrackingSection() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["seo-tracking-admin"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("seo_tracking").select("*");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const [vals, setVals] = useState<Record<string, string>>({});
  const getVal = (key: string) =>
    vals[key] ?? data?.find((r: any) => r.provider === key)?.tracking_id ?? "";

  const upsert = useMutation({
    mutationFn: async ({ provider, tracking_id, enabled }: { provider: string; tracking_id: string; enabled: boolean }) => {
      const { error } = await (supabase as any)
        .from("seo_tracking")
        .upsert(
          { provider, tracking_id, enabled, updated_at: new Date().toISOString() },
          { onConflict: "provider" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-tracking-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-tracking-enabled"] });
      toast({ title: "Rastreamento salvo" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (provider: string) => {
      const { error } = await (supabase as any).from("seo_tracking").delete().eq("provider", provider);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-tracking-admin"] });
      qc.invalidateQueries({ queryKey: ["seo-tracking-enabled"] });
      toast({ title: "Removido" });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">IDs de Rastreamento</h2>
        <p className="text-sm text-muted-foreground">
          Analytics e pixels de conversão. Os scripts são carregados automaticamente quando ativados.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {TRACKING_PROVIDERS.map((p) => {
          const current = data?.find((r: any) => r.provider === p.key);
          const enabled = current?.enabled ?? true;
          return (
            <Card key={p.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  {p.label}
                  {current && (
                    <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "Ativo" : "Inativo"}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Input
                  value={getVal(p.key)}
                  placeholder={p.placeholder}
                  onChange={(e) => setVals((s) => ({ ...s, [p.key]: e.target.value }))}
                />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => {
                        const tid = getVal(p.key).trim();
                        if (!tid) return;
                        upsert.mutate({ provider: p.key, tracking_id: tid, enabled: v });
                      }}
                    />
                    <span className="text-sm">Ativo</span>
                  </div>
                  <div className="flex gap-2">
                    {current && (
                      <Button variant="outline" size="sm" onClick={() => remove.mutate(p.key)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        const tid = getVal(p.key).trim();
                        if (!tid) return;
                        upsert.mutate({ provider: p.key, tracking_id: tid, enabled });
                      }}
                    >
                      <Save className="h-3 w-3 mr-1" /> Salvar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function buildSitemap(routes: { path: string; priority?: string; changefreq?: string }[]) {
  const today = new Date().toISOString().split("T")[0];
  const urls = routes
    .map(
      (r) =>
        `  <url>\n    <loc>${SITE_URL}${r.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${r.changefreq ?? "weekly"}</changefreq>\n    <priority>${r.priority ?? "0.7"}</priority>\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function SitemapRobotsSection() {
  const qc = useQueryClient();
  const { data: artifacts } = useQuery({
    queryKey: ["seo-artifacts"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("seo_artifacts").select("*");
      if (error) throw error;
      return (data as any[]) ?? [];
    },
  });

  const sitemap = artifacts?.find((a: any) => a.id === "sitemap");
  const robots = artifacts?.find((a: any) => a.id === "robots");
  const [robotsContent, setRobotsContent] = useState<string | null>(null);

  const regenerate = useMutation({
    mutationFn: async () => {
      const publicRoutes = [
        { path: "/", priority: "1.0", changefreq: "weekly" },
        { path: "/auth", priority: "0.5" },
      ];
      // Add published blog posts
      const { data: posts } = await (supabase as any)
        .from("blog_posts")
        .select("slug")
        .eq("status", "published");
      (posts ?? []).forEach((p: any) => publicRoutes.push({ path: `/blog/${p.slug}`, priority: "0.6" }));

      const content = buildSitemap(publicRoutes);
      const { error } = await (supabase as any).from("seo_artifacts").upsert(
        { id: "sitemap", content, url_count: publicRoutes.length, generated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-artifacts"] });
      toast({ title: "Sitemap regenerado" });
    },
    onError: (e: any) => toast({ title: "Erro", description: e.message, variant: "destructive" }),
  });

  const saveRobots = useMutation({
    mutationFn: async (content: string) => {
      const { error } = await (supabase as any).from("seo_artifacts").upsert(
        { id: "robots", content, generated_at: new Date().toISOString() },
        { onConflict: "id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seo-artifacts"] });
      toast({ title: "robots.txt salvo" });
    },
  });

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentRobots =
    robotsContent ??
    robots?.content ??
    `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Sitemap & robots.txt</h2>
        <p className="text-sm text-muted-foreground">
          Gere o sitemap automaticamente com as rotas públicas e configure as regras do robots.txt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <FileCode className="h-4 w-4" /> sitemap.xml
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
                <RefreshCw className={`h-3 w-3 mr-1 ${regenerate.isPending ? "animate-spin" : ""}`} />
                Regenerar
              </Button>
              {sitemap && (
                <Button size="sm" variant="outline" onClick={() => downloadFile("sitemap.xml", sitemap.content, "application/xml")}>
                  <Download className="h-3 w-3 mr-1" /> Baixar
                </Button>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sitemap ? (
            <>
              <div className="text-xs text-muted-foreground mb-2">
                {sitemap.url_count} URLs · Gerado em {new Date(sitemap.generated_at).toLocaleString("pt-BR")}
              </div>
              <Textarea readOnly rows={10} value={sitemap.content} className="font-mono text-xs" />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum sitemap gerado. Clique em "Regenerar".</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <FileCode className="h-4 w-4" /> robots.txt
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => downloadFile("robots.txt", currentRobots, "text/plain")}>
                <Download className="h-3 w-3 mr-1" /> Baixar
              </Button>
              <Button size="sm" onClick={() => saveRobots.mutate(currentRobots)}>
                <Save className="h-3 w-3 mr-1" /> Salvar
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={8}
            value={currentRobots}
            onChange={(e) => setRobotsContent(e.target.value)}
            className="font-mono text-xs"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusSection() {
  const { data: seo } = useQuery({
    queryKey: ["admin-seo"],
    queryFn: async () => (await supabase.from("seo_settings").select("*")).data as Seo[],
  });
  const { data: verifications } = useQuery({
    queryKey: ["seo-verifications-admin"],
    queryFn: async () => ((await (supabase as any).from("seo_verifications").select("*")).data as any[]) ?? [],
  });
  const { data: tracking } = useQuery({
    queryKey: ["seo-tracking-admin"],
    queryFn: async () => ((await (supabase as any).from("seo_tracking").select("*")).data as any[]) ?? [],
  });
  const { data: artifacts } = useQuery({
    queryKey: ["seo-artifacts"],
    queryFn: async () => ((await (supabase as any).from("seo_artifacts").select("*")).data as any[]) ?? [],
  });

  const checks = useMemo(() => {
    const totalRoutes = seo?.length ?? 0;
    const okRoutes = (seo ?? []).filter((s) => (s.title?.length ?? 0) > 0 && (s.description?.length ?? 0) >= 50).length;
    const sitemap = artifacts?.find((a: any) => a.id === "sitemap");
    const sitemapFresh = sitemap && Date.now() - new Date(sitemap.generated_at).getTime() < 7 * 86400000;
    const activeTracking = (tracking ?? []).filter((t: any) => t.enabled).length;

    return [
      { ok: totalRoutes > 0 && okRoutes === totalRoutes, label: `Meta tags completas em todas as rotas (${okRoutes}/${totalRoutes})` },
      { ok: (verifications?.length ?? 0) > 0, label: "Pelo menos uma verificação configurada" },
      { ok: activeTracking > 0, label: `Rastreamento ativo (${activeTracking} provedor(es))` },
      { ok: !!sitemap, label: "Sitemap gerado" },
      { ok: !!sitemapFresh, label: "Sitemap atualizado nos últimos 7 dias" },
      { ok: !!artifacts?.find((a: any) => a.id === "robots"), label: "robots.txt configurado" },
      { ok: (seo ?? []).every((s) => !s.canonical_url || s.canonical_url.includes("climapolitico")), label: "Canonical aponta para o domínio oficial" },
    ];
  }, [seo, verifications, tracking, artifacts]);

  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" /> Saúde SEO
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-6">
            <div className="text-5xl font-bold">{score}</div>
            <div className="flex-1">
              <div className="text-sm text-muted-foreground">
                {passed} de {checks.length} verificações OK
              </div>
              <div className="h-2 bg-muted rounded-full mt-2 overflow-hidden">
                <div
                  className={`h-full transition-all ${score >= 80 ? "bg-green-500" : score >= 50 ? "bg-yellow-500" : "bg-destructive"}`}
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {checks.map((c, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {c.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive shrink-0" />
                )}
                <span className={c.ok ? "" : "text-muted-foreground"}>{c.label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminSeoComplete() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">SEO Completo</h1>
        <p className="text-muted-foreground">
          Meta tags, verificações de buscadores, rastreamento, sitemap & robots.txt e saúde geral.
        </p>
      </div>

      <Tabs defaultValue="status" className="space-y-4">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="status"><Activity className="h-4 w-4 mr-1" /> Status</TabsTrigger>
          <TabsTrigger value="meta"><Globe className="h-4 w-4 mr-1" /> Meta Tags</TabsTrigger>
          <TabsTrigger value="verification"><ShieldCheck className="h-4 w-4 mr-1" /> Verificação</TabsTrigger>
          <TabsTrigger value="tracking"><Activity className="h-4 w-4 mr-1" /> Rastreamento</TabsTrigger>
          <TabsTrigger value="sitemap"><FileCode className="h-4 w-4 mr-1" /> Sitemap & robots</TabsTrigger>
        </TabsList>
        <TabsContent value="status"><StatusSection /></TabsContent>
        <TabsContent value="meta"><MetaTagsSection /></TabsContent>
        <TabsContent value="verification"><VerificationsSection /></TabsContent>
        <TabsContent value="tracking"><TrackingSection /></TabsContent>
        <TabsContent value="sitemap"><SitemapRobotsSection /></TabsContent>
      </Tabs>
    </div>
  );
}
