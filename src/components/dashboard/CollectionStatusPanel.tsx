import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const NETWORKS = [
  { key: "Google News", color: "#22C55E", aliases: ["google_news", "googlenews", "google news"] },
  { key: "TikTok", color: "#000000", aliases: ["tiktok", "tik_tok"] },
  { key: "Reddit", color: "#FF4500", aliases: ["reddit"] },
  { key: "Telegram", color: "#0088CC", aliases: ["telegram"] },
  { key: "Wikipedia", color: "#636363", aliases: ["wikipedia"] },
  { key: "Threads", color: "#1F2937", aliases: ["threads"] },
  { key: "YouTube", color: "#FF0000", aliases: ["youtube"] },
  { key: "Twitter/X", color: "#1DA1F2", aliases: ["twitter", "x", "twitter/x"] },
];

function formatRelative(date: Date | null): string {
  if (!date) return "Nunca";
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora mesmo";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

export const CollectionStatusPanel = () => {
  const { user } = useAuth();

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["collection-status", user?.id],
    queryFn: async () => {
      if (!user) return null;

      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Latest interactions per user (limit large but bounded)
      const { data: interactions } = await supabase
        .from("social_interactions")
        .select("social_network, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5000);

      // Recent failure notifications
      const { data: notifs } = await supabase
        .from("notifications")
        .select("title, message, severity, created_at, metadata, type")
        .eq("user_id", user.id)
        .in("severity", ["warning", "error"])
        .gte("created_at", since24h)
        .order("created_at", { ascending: false })
        .limit(50);

      const stats = NETWORKS.map((n) => {
        const matches = (interactions || []).filter((i) => {
          const sn = (i.social_network || "").toLowerCase();
          return n.aliases.includes(sn) || sn === n.key.toLowerCase();
        });
        const latest = matches[0]?.created_at ? new Date(matches[0].created_at) : null;
        const last24h = matches.filter((m) => m.created_at >= since24h).length;

        // Find failure notifications that mention this network
        const failure = (notifs || []).find((nt) => {
          const haystack = `${nt.title} ${nt.message}`.toLowerCase();
          return n.aliases.some((a) => haystack.includes(a)) || haystack.includes(n.key.toLowerCase());
        });

        let status: "healthy" | "stale" | "error" | "empty" = "empty";
        if (failure) status = "error";
        else if (latest) {
          const ageH = (Date.now() - latest.getTime()) / 3600000;
          status = ageH > 48 ? "stale" : "healthy";
        }

        return {
          network: n.key,
          color: n.color,
          latest,
          last24h,
          totalSampled: matches.length,
          status,
          failureMessage: failure?.message || null,
        };
      });

      return stats;
    },
    enabled: !!user,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Status de Coleta por Rede</CardTitle>
          <CardDescription>
            Última coleta, volume nas últimas 24h e falhas recentes por fonte
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {(data || []).map((row) => (
              <div
                key={row.network}
                className="rounded-lg border bg-card p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: row.color }}
                    />
                    <span className="text-sm font-medium">{row.network}</span>
                  </div>
                  {row.status === "healthy" && (
                    <Badge variant="outline" className="text-success border-success/40">
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Ativa
                    </Badge>
                  )}
                  {row.status === "stale" && (
                    <Badge variant="outline" className="text-warning border-warning/40">
                      <Clock className="h-3 w-3 mr-1" /> Desatualizada
                    </Badge>
                  )}
                  {row.status === "error" && (
                    <Badge variant="outline" className="text-destructive border-destructive/40">
                      <AlertTriangle className="h-3 w-3 mr-1" /> Falha
                    </Badge>
                  )}
                  {row.status === "empty" && (
                    <Badge variant="outline" className="text-muted-foreground">
                      Sem dados
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  Última coleta: <strong>{formatRelative(row.latest)}</strong>
                </div>
                <div className="text-xs text-muted-foreground">
                  Últimas 24h: <strong>{row.last24h.toLocaleString("pt-BR")}</strong> itens
                </div>
                {row.failureMessage && (
                  <div className="text-xs text-destructive line-clamp-2" title={row.failureMessage}>
                    {row.failureMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
