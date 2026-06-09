import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Linkedin,
  Youtube,
  Twitter,
  Facebook,
  Instagram,
  MessageCircle,
  Send,
  Newspaper,
  Globe,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Loader2,
  Rss,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

import { resolveOriginalPostUrl } from "@/lib/originalPostUrl";

interface FeedItem {
  id: string;
  candidate_id: string;
  comment_text: string | null;
  comment_author: string | null;
  author_profile_url: string | null;
  original_posted_at: string | null;
  collected_at: string | null;
  sentiment_label: string | null;
  social_network: string;
  likes_count: number | null;
  replies_count: number | null;
  shares_count: number | null;
  post_url: string | null;
  post_id: string | null;
  external_id: string | null;
  author_handle: string | null;
  platform: string | null;
}

interface CandidateOption {
  id: string;
  full_name: string;
}

type NetworkKey =
  | "linkedin"
  | "youtube"
  | "twitter"
  | "facebook"
  | "instagram"
  | "reddit"
  | "telegram"
  | "news"
  | "gdelt";

interface NetworkConfig {
  key: NetworkKey;
  label: string;
  icon: typeof Linkedin;
  color: string;
  collectorFn?: string;
  /** valores aceitos no campo social_network do banco */
  match: string[];
}

const NETWORKS: NetworkConfig[] = [
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, color: "#0A66C2", collectorFn: "linkedin-collector", match: ["linkedin"] },
  { key: "youtube", label: "YouTube", icon: Youtube, color: "#FF0000", match: ["youtube"] },
  { key: "twitter", label: "Twitter/X", icon: Twitter, color: "#1DA1F2", match: ["twitter"] },
  { key: "facebook", label: "Facebook", icon: Facebook, color: "#1877F2", match: ["facebook"] },
  { key: "instagram", label: "Instagram", icon: Instagram, color: "#E4405F", match: ["instagram"] },
  { key: "reddit", label: "Reddit", icon: MessageCircle, color: "#FF4500", collectorFn: "search-reddit-mentions", match: ["reddit"] },
  { key: "telegram", label: "Telegram", icon: Send, color: "#26A5E4", collectorFn: "search-telegram-mentions", match: ["telegram"] },
  { key: "news", label: "Notícias", icon: Newspaper, color: "#6366F1", match: ["google_news"] },
  { key: "gdelt", label: "GDELT", icon: Globe, color: "#10B981", collectorFn: "gdelt-collector", match: ["gdelt"] },
];

const PAGE_SIZE = 20;

const splitTitleDescription = (text: string | null) => {
  if (!text) return { title: "(sem título)", description: "" };
  const [first, ...rest] = text.split("\n\n");
  return { title: first.trim(), description: rest.join("\n\n").trim() };
};

const sentimentVariant = (label: string | null): "default" | "secondary" | "destructive" | "outline" => {
  const v = (label || "").toLowerCase();
  if (v.includes("positiv")) return "default";
  if (v.includes("negativ")) return "destructive";
  if (v.includes("neutr")) return "secondary";
  return "outline";
};

// Detecta conteúdo que parece código/markup e deve ser ocultado do feed
const looksLikeCode = (text: string | null): boolean => {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 3) return false;
  const codePatterns: RegExp[] = [
    /<\/?[a-z][\s\S]*?>/i,                       // tags HTML/XML
    /&(?:lt|gt|amp|quot|nbsp|#\d+);/i,           // entidades HTML
    /\b(function|const|let|var|return|import|export|class)\s/, // JS
    /=>\s*[\{\(]/,                               // arrow functions
    /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/,           // templates
    /\$\{[^}]+\}/,                               // template literals
    /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER)\s/i, // SQL
    /^\s*[\[\{][\s\S]*[\]\}]\s*$/,               // JSON puro
    /\b(?:document|window|console)\.[a-z]/i,     // JS APIs
    /```|^\s{4,}\S/m,                            // code fences / indent
    /\b[a-z_][\w-]*\s*:\s*[^,\n]+;/i,            // CSS-like
  ];
  let hits = 0;
  for (const re of codePatterns) if (re.test(t)) hits++;
  // densidade de símbolos típicos de código
  const symbols = (t.match(/[<>{};=]/g) || []).length;
  const density = symbols / Math.max(t.length, 1);
  return hits >= 2 || density > 0.08;
};

const dedupeItems = (arr: FeedItem[]): FeedItem[] => {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const it of arr) {
    const norm = (it.comment_text || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200);
    const key = `${it.author_profile_url || it.comment_author || ""}::${norm}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
};

function NetworkFeed({ network }: { network: NetworkConfig }) {
  const [candidates, setCandidates] = useState<CandidateOption[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("all");
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [collecting, setCollecting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name")
        .order("full_name", { ascending: true });
      setCandidates(data || []);
    })();
  }, []);

  // Reset paginação ao trocar de rede
  useEffect(() => {
    setPage(0);
    setSelectedCandidate("all");
  }, [network.key]);

  useEffect(() => {
    let cancelled = false;

    const runQuery = async () => {
      const startedAt = performance.now();
      // Sem `count` para evitar scan extra em tabelas grandes (~450k linhas YouTube).
      // O índice (social_network, original_posted_at DESC) permite paginação rápida.
      let query = supabase
        .from("social_interactions")
        .select(
          "id, candidate_id, comment_text, comment_author, author_profile_url, original_posted_at, collected_at, sentiment_label, social_network, likes_count, replies_count, shares_count, post_url, post_id, external_id, author_handle, platform"
        )
        .in("social_network", network.match)
        .order("original_posted_at", { ascending: false, nullsFirst: false })
        .order("collected_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      if (selectedCandidate !== "all") {
        query = query.eq("candidate_id", selectedCandidate);
      }

      const result = await query;
      const elapsed = Math.round(performance.now() - startedAt);
      return { ...result, elapsed };
    };

    const isTransient = (err: any): boolean => {
      const msg = String(err?.message || "").toLowerCase();
      const code = String(err?.code || "");
      return (
        code === "57014" /* statement_timeout */ ||
        code === "08006" /* connection_failure */ ||
        msg.includes("timeout") ||
        msg.includes("fetch failed") ||
        msg.includes("network")
      );
    };

    (async () => {
      setLoading(true);
      let attempt = 0;
      const maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        const { data, error, elapsed } = await runQuery();
        if (cancelled) return;

        if (!error) {
          const received = data?.length ?? 0;
          const items = (data || []) as FeedItem[];
          const afterFilter = items.filter((it) => !looksLikeCode(it.comment_text));
          const afterDedupe = dedupeItems(afterFilter);
          console.info(
            `[SocialFeeds] ${network.key} feed recebido — recebidos=${received} apósFiltro=${afterFilter.length} apósDedupe/Ordenação=${afterDedupe.length} renderizados=${afterDedupe.length} tempo=${elapsed}ms tentativa=${attempt}`
          );
          setItems(items);
          setTotal(received < PAGE_SIZE ? page * PAGE_SIZE + received : (page + 2) * PAGE_SIZE);
          setLoading(false);
          return;
        }

        console.error(
          `[SocialFeeds] ${network.key} falhou — tentativa ${attempt}/${maxAttempts}`,
          {
            code: (error as any).code,
            message: error.message,
            details: (error as any).details,
            hint: (error as any).hint,
            elapsedMs: elapsed,
            range: [page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1],
            filter: { social_network: network.match, candidate: selectedCandidate },
          }
        );

        if (attempt < maxAttempts && isTransient(error)) {
          const delay = 400 * Math.pow(2, attempt - 1);
          toast.info(
            `Feed de ${network.label} temporariamente indisponível. Tentando nova sincronização…`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        toast.error(
          `Não foi possível carregar o feed de ${network.label}. Tente novamente em instantes.`
        );
        setItems([]);
        setTotal(0);
        setLoading(false);
        return;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [page, selectedCandidate, network.key]);

  const candidateMap = useMemo(() => {
    const m = new Map<string, string>();
    candidates.forEach((c) => m.set(c.id, c.full_name));
    return m;
  }, [candidates]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleItems = useMemo(
    () => dedupeItems(items.filter((it) => !looksLikeCode(it.comment_text))),
    [items]
  );
  const hiddenCount = items.length - visibleItems.length;

  const handleRunCollector = async () => {
    if (!network.collectorFn) {
      toast.info(`Coleta de ${network.label} é automática (cron). Aguarde o próximo ciclo.`);
      return;
    }
    setCollecting(true);
    try {
      const { error } = await supabase.functions.invoke(network.collectorFn);
      if (error) throw error;
      toast.success(`Coleta de ${network.label} iniciada — atualize em alguns segundos.`);
    } catch (e) {
      console.error(e);
      toast.error(`Não foi possível iniciar a coleta de ${network.label}.`);
    } finally {
      setCollecting(false);
    }
  };

  const Icon = network.icon;

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Icon className="h-5 w-5" style={{ color: network.color }} />
            Feed de {network.label}
          </h2>
          <p className="text-sm text-muted-foreground">
            Total coletado: {total.toLocaleString("pt-BR")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedCandidate}
            onValueChange={(v) => {
              setSelectedCandidate(v);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Filtrar por candidato" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os candidatos</SelectItem>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleRunCollector} disabled={collecting} variant="outline">
            {collecting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Coletar agora
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : visibleItems.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Nenhum item válido de {network.label} para exibir
            {hiddenCount > 0 ? ` (${hiddenCount} item(ns) ocultos por conterem código ou duplicatas).` : "."}
            {network.collectorFn ? ' Clique em "Coletar agora" para buscar mais.' : " A coleta acontece automaticamente."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {hiddenCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {hiddenCount} item(ns) ocultos nesta página (código ou duplicatas).
            </p>
          )}
          {visibleItems.map((p) => {
            const { title, description } = splitTitleDescription(p.comment_text);
            const date = p.original_posted_at || p.collected_at;
            return (
              <Card key={p.id} className="hover-lift transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-base font-semibold line-clamp-2">{title}</CardTitle>
                    {p.sentiment_label && (
                      <Badge variant={sentimentVariant(p.sentiment_label)} className="shrink-0">
                        {p.sentiment_label}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium">{p.comment_author || network.label}</span>
                    {date && (
                      <span>
                        {format(new Date(date), "dd 'de' MMM 'de' yyyy, HH:mm", { locale: ptBR })}
                      </span>
                    )}
                    {candidateMap.get(p.candidate_id) && (
                      <Badge variant="outline" className="text-xs">
                        {candidateMap.get(p.candidate_id)}
                      </Badge>
                    )}
                    {(p.likes_count || p.replies_count || p.shares_count) ? (
                      <span className="text-muted-foreground">
                        {p.likes_count ? `❤ ${p.likes_count} ` : ""}
                        {p.replies_count ? `💬 ${p.replies_count} ` : ""}
                        {p.shares_count ? `↗ ${p.shares_count}` : ""}
                      </span>
                    ) : null}
                  </CardDescription>
                </CardHeader>
                {description && (
                  <CardContent className="pt-0 pb-3">
                    <p className="text-sm text-muted-foreground line-clamp-3">{description}</p>
                  </CardContent>
                )}
                <CardContent className="pt-0">
                  {(() => {
                    const url = resolveOriginalPostUrl(p);
                    if (url) {
                      return (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ver publicação original
                        </a>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground italic">
                        Link original indisponível
                      </span>
                    );
                  })()}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-muted-foreground">
            Página {page + 1} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Próxima <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SocialFeeds() {
  const [activeTab, setActiveTab] = useState<NetworkKey>("linkedin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Rss className="h-7 w-7 text-primary" />
          Feeds das Redes Sociais
        </h1>
        <p className="text-muted-foreground mt-1">
          Selecione uma rede para ver posts, menções e comentários coletados.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as NetworkKey)}>
        <TabsList className="flex flex-wrap h-auto justify-start gap-1">
          {NETWORKS.map((n) => {
            const Icon = n.icon;
            return (
              <TabsTrigger key={n.key} value={n.key} className="gap-1.5">
                <Icon className="h-4 w-4" style={{ color: n.color }} />
                {n.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {NETWORKS.map((n) => (
          <TabsContent key={n.key} value={n.key} className="mt-6">
            {/* Renderiza apenas a tab ativa para evitar queries paralelas */}
            {activeTab === n.key && <NetworkFeed network={n} />}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
