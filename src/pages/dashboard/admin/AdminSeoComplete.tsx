import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Search,
  ShieldCheck,
  BarChart3,
  Globe,
  Activity,
  Save,
  ExternalLink,
  CheckCircle2,
  Circle,
} from "lucide-react";

const HOME_ROUTE = "/";
const PUBLIC_DOMAIN = "https://climapolitico.com.br";

type SeoRow = {
  id?: string;
  route: string;
  title: string | null;
  description: string | null;
  keywords: string | null;
  og_image: string | null;
  og_title?: string | null;
  og_description?: string | null;
  canonical_url?: string | null;
};

type VerifProvider = "google" | "bing";
type TrackingProvider = "ga4" | "gtm" | "meta_pixel";

const VERIF_LABEL: Record<VerifProvider, string> = {
  google: "Google Search Console",
  bing: "Bing Webmaster",
};
const VERIF_HELP: Record<VerifProvider, { hint: string; link: { url: string; label: string } }> = {
  google: {
    hint: 'No Search Console escolha "Tag HTML" e cole aqui apenas o conteúdo entre aspas do atributo content.',
    link: { url: "https://search.google.com/search-console", label: "Abrir Search Console" },
  },
  bing: {
    hint: "Cole a meta tag completa fornecida pelo Bing Webmaster Tools.",
    link: { url: "https://www.bing.com/webmasters", label: "Abrir Bing Webmaster" },
  },
};

const TRACKING_LABEL: Record<TrackingProvider, string> = {
  ga4: "Google Analytics 4 (Measurement ID)",
  gtm: "Google Tag Manager (Container ID)",
  meta_pixel: "Meta Pixel (Facebook / Instagram)",
};
const TRACKING_HELP: Record<TrackingProvider, { url: string; label: string }> = {
  ga4: { url: "https://analytics.google.com", label: "Abrir Analytics" },
  gtm: { url: "https://tagmanager.google.com", label: "Abrir GTM" },
  meta_pixel: { url: "https://business.facebook.com/events_manager", label: "Abrir Events Manager" },
};

export default function AdminSeoComplete() {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const { data: seoRows = [] } = useQuery({
    queryKey: ["seo_settings_all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seo_settings").select("*");
      if (error) throw error;
      return data as SeoRow[];
    },
  });
  const { data: verifs = [] } = useQuery({
    queryKey: ["seo_verifications"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("seo_verifications").select("*");
      if (error) throw error;
      return data as { provider: string; code: string }[];
    },
  });
  const { data: tracks = [] } = useQuery({
    queryKey: ["seo_tracking"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("seo_tracking").select("*");
      if (error) throw error;
      return data as { provider: string; tracking_id: string; enabled: boolean }[];
    },
  });

  const homeRow = useMemo<SeoRow>(() => {
    const found = seoRows.find((r) => r.route === HOME_ROUTE);
    return (
      found ?? {
        route: HOME_ROUTE,
        title: "",
        description: "",
        keywords: "",
        og_image: "",
      }
    );
  }, [seoRows]);

  // local form state
  const [meta, setMeta] = useState<SeoRow>(homeRow);
  const [verifVals, setVerifVals] = useState<Record<VerifProvider, string>>({ google: "", bing: "" });
  const [trackVals, setTrackVals] = useState<Record<TrackingProvider, string>>({
    ga4: "",
    gtm: "",
    meta_pixel: "",
  });

  useEffect(() => setMeta(homeRow), [homeRow]);
  useEffect(() => {
    setVerifVals({
      google: verifs.find((v) => v.provider === "google")?.code ?? "",
      bing: verifs.find((v) => v.provider === "bing")?.code ?? "",
    });
  }, [verifs]);
  useEffect(() => {
    setTrackVals({
      ga4: tracks.find((t) => t.provider === "ga4")?.tracking_id ?? "",
      gtm: tracks.find((t) => t.provider === "gtm")?.tracking_id ?? "",
      meta_pixel: tracks.find((t) => t.provider === "meta_pixel")?.tracking_id ?? "",
    });
  }, [tracks]);

  async function saveAll() {
    setSaving(true);
    try {
      // Meta tags (upsert pela rota home)
      const payload = {
        route: HOME_ROUTE,
        title: meta.title || null,
        description: meta.description || null,
        keywords: meta.keywords || null,
        og_image: meta.og_image || null,
      };
      const { error: e1 } = await supabase
        .from("seo_settings")
        .upsert(payload, { onConflict: "route" });
      if (e1) throw e1;

      // Verificações
      for (const provider of ["google", "bing"] as VerifProvider[]) {
        const code = verifVals[provider]?.trim();
        if (code) {
          const { error } = await (supabase as any)
            .from("seo_verifications")
            .upsert({ provider, code }, { onConflict: "provider" });
          if (error) throw error;
        } else {
          await (supabase as any).from("seo_verifications").delete().eq("provider", provider);
        }
      }

      // Rastreamento
      for (const provider of ["ga4", "gtm", "meta_pixel"] as TrackingProvider[]) {
        const tracking_id = trackVals[provider]?.trim();
        if (tracking_id) {
          const { error } = await (supabase as any)
            .from("seo_tracking")
            .upsert(
              { provider, tracking_id, enabled: true },
              { onConflict: "provider" },
            );
          if (error) throw error;
        } else {
          await (supabase as any).from("seo_tracking").delete().eq("provider", provider);
        }
      }

      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["seo_settings_all"] });
      qc.invalidateQueries({ queryKey: ["seo_verifications"] });
      qc.invalidateQueries({ queryKey: ["seo_tracking"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold">SEO / Google</h1>
          <p className="text-muted-foreground">
            Configure como o site aparece no Google e ative ferramentas de monitoramento.
          </p>
        </div>
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>

      <Tabs defaultValue="meta">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 h-auto">
          <TabsTrigger value="meta" className="gap-2"><Search className="h-4 w-4" /> Meta Tags</TabsTrigger>
          <TabsTrigger value="verif" className="gap-2"><ShieldCheck className="h-4 w-4" /> Verificação</TabsTrigger>
          <TabsTrigger value="track" className="gap-2"><BarChart3 className="h-4 w-4" /> Rastreamento</TabsTrigger>
          <TabsTrigger value="sitemap" className="gap-2"><Globe className="h-4 w-4" /> Sitemap/Robots</TabsTrigger>
          <TabsTrigger value="status" className="gap-2"><Activity className="h-4 w-4" /> Status</TabsTrigger>
        </TabsList>

        {/* META TAGS */}
        <TabsContent value="meta" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Como o site aparece no Google</CardTitle>
              <CardDescription>
                Estas informações são mostradas nos resultados de busca e ao compartilhar nas redes sociais.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <Field
                label="Título da página (até 60 caracteres)"
                counter={`${(meta.title ?? "").length}/60`}
              >
                <Input
                  value={meta.title ?? ""}
                  maxLength={60}
                  onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                />
              </Field>

              <Field
                label="Descrição (até 160 caracteres)"
                counter={`${(meta.description ?? "").length}/160`}
              >
                <Textarea
                  value={meta.description ?? ""}
                  maxLength={160}
                  rows={3}
                  onChange={(e) => setMeta({ ...meta, description: e.target.value })}
                />
              </Field>

              <Field label="Palavras-chave (separadas por vírgula)">
                <Input
                  value={meta.keywords ?? ""}
                  onChange={(e) => setMeta({ ...meta, keywords: e.target.value })}
                />
              </Field>

              <Field
                label="URL da imagem de compartilhamento (Open Graph)"
                hint="Imagem exibida ao compartilhar no WhatsApp, Facebook, etc."
              >
                <Input
                  value={meta.og_image ?? ""}
                  onChange={(e) => setMeta({ ...meta, og_image: e.target.value })}
                  placeholder="https://..."
                />
              </Field>

              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground mb-2">Pré-visualização Google:</p>
                <div className="text-[#1a0dab] text-lg leading-snug font-medium">
                  {meta.title || "Título da página"}
                </div>
                <div className="text-[#006621] text-xs">{PUBLIC_DOMAIN}</div>
                <div className="text-sm text-foreground/80 mt-1">
                  {meta.description || "Descrição da página aparece aqui."}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VERIFICAÇÃO */}
        <TabsContent value="verif" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Códigos de verificação</CardTitle>
              <CardDescription>
                Cole o código fornecido pelo Google Search Console / Bing para provar que você é dono do site.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {(["google", "bing"] as VerifProvider[]).map((p) => (
                <div key={p} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{VERIF_LABEL[p]}</Label>
                    <a
                      href={VERIF_HELP[p].link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      {VERIF_HELP[p].link.label} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <Input
                    value={verifVals[p]}
                    onChange={(e) => setVerifVals({ ...verifVals, [p]: e.target.value })}
                    placeholder={p === "google" ? "google-site-verification=..." : '<meta name="msvalidate.01" content="..." />'}
                  />
                  <p className="text-xs text-muted-foreground">{VERIF_HELP[p].hint}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RASTREAMENTO */}
        <TabsContent value="track" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>IDs de rastreamento</CardTitle>
              <CardDescription>
                Conecte ferramentas de análise. Os scripts são carregados automaticamente nas páginas públicas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {(["ga4", "gtm", "meta_pixel"] as TrackingProvider[]).map((p) => (
                <div key={p} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Label>{TRACKING_LABEL[p]}</Label>
                    <a
                      href={TRACKING_HELP[p].url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                    >
                      {TRACKING_HELP[p].label} <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <Input
                    value={trackVals[p]}
                    onChange={(e) => setTrackVals({ ...trackVals, [p]: e.target.value })}
                    placeholder={
                      p === "ga4"
                        ? "G-XXXXXXXXXX"
                        : p === "gtm"
                          ? "GTM-XXXXXXX"
                          : "ID do pixel ou snippet completo"
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SITEMAP / ROBOTS */}
        <TabsContent value="sitemap" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Sitemap & robots.txt</CardTitle>
              <CardDescription>Arquivos que dizem ao Google quais páginas indexar.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <FileRow
                name="sitemap.xml"
                desc="Lista das páginas do site (gerada automaticamente)"
                href="/sitemap.xml"
                label="Ver"
              />
              <FileRow
                name="robots.txt"
                desc="Diz quais robôs podem visitar o site"
                href="/robots.txt"
                label="Ver atual"
              />
              <p className="text-xs text-muted-foreground pt-2">
                💡 Esses arquivos ficam em <code>public/robots.txt</code> e{" "}
                <code>public/sitemap.xml</code>. Para mudanças no robots.txt, peça ao suporte.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* STATUS */}
        <TabsContent value="status" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Status das configurações</CardTitle>
              <CardDescription>Verifique o que está ativo no seu site agora.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              <StatusRow label="Título da página" ok={!!meta.title} />
              <StatusRow label="Descrição (meta description)" ok={!!meta.description} />
              <StatusRow label="Palavras-chave" ok={!!meta.keywords} />
              <StatusRow label="Imagem de compartilhamento" ok={!!meta.og_image} />
              <StatusRow label="Verificação Google Search Console" ok={!!verifVals.google} />
              <StatusRow label="Verificação Bing" ok={!!verifVals.bing} />
              <StatusRow label="Google Analytics 4" ok={!!trackVals.ga4} />
              <StatusRow label="Google Tag Manager" ok={!!trackVals.gtm} />
              <StatusRow label="Meta Pixel" ok={!!trackVals.meta_pixel} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Acompanhe o andamento</CardTitle>
              <CardDescription>
                Os dados de tráfego, cliques e indexação ficam no painel oficial do Google.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid sm:grid-cols-2 gap-3">
              <ExternalCard title="Google Search Console" desc="Cliques, impressões, posição" href="https://search.google.com/search-console" />
              <ExternalCard title="Google Analytics 4" desc="Visitas, sessões, conversões" href="https://analytics.google.com" />
              <ExternalCard title="Teste de Rich Results" desc="Verifica se o Google lê seu site" href="https://search.google.com/test/rich-results" />
              <ExternalCard title="PageSpeed Insights" desc="Velocidade e performance" href="https://pagespeed.web.dev" />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({
  label,
  hint,
  counter,
  children,
}: {
  label: string;
  hint?: string;
  counter?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{hint}</span>
        {counter && <span>{counter}</span>}
      </div>
    </div>
  );
}

function FileRow({ name, desc, href, label }: { name: string; desc: string; href: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div>
        <div className="font-medium text-sm">{name}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Button variant="outline" size="sm" asChild>
        <a href={href} target="_blank" rel="noreferrer" className="gap-1">
          <ExternalLink className="h-3.5 w-3.5" /> {label}
        </a>
      </Button>
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm">{label}</span>
      {ok ? (
        <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 bg-emerald-500/10">
          <CheckCircle2 className="h-3.5 w-3.5" /> Configurado
        </Badge>
      ) : (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Circle className="h-3.5 w-3.5" /> Pendente
        </Badge>
      )}
    </div>
  );
}

function ExternalCard({ title, desc, href }: { title: string; desc: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-start justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40 transition"
    >
      <div>
        <div className="font-medium text-sm">{title}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <ExternalLink className="h-4 w-4 text-muted-foreground" />
    </a>
  );
}
