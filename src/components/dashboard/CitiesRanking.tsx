import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, ThumbsUp, TrendingUp, TrendingDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inferLocation, type UF } from "@/lib/brazilStatesInference";
import { ALL_NETWORKS_VALUE, NETWORKS } from "@/pages/dashboard/regionalAnalysis.helpers";
import { fetchAllPaginated } from "@/lib/supabasePagination";
import { subDays } from "date-fns";

interface Props {
  userId: string;
  candidateId: string;
  network: string;
}

interface CityAgg {
  city: string;
  uf: UF | null;
  total: number;
  pos: number;
  neg: number;
  neu: number;
  recent: number; // últimos 7 dias
  previous: number; // 7-14 dias
}

function sentKey(s: string | null): "pos" | "neg" | "neu" {
  const k = (s || "").toLowerCase();
  if (k.startsWith("pos")) return "pos";
  if (k.startsWith("neg")) return "neg";
  return "neu";
}

export default function CitiesRanking({ userId, candidateId, network }: Props) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState("");
  const [totalRecords, setTotalRecords] = useState(0);

  useEffect(() => {
    if (!userId || !candidateId) return;
    setRows(null);
    (async () => {
      const data = await fetchAllPaginated<any>((from, to) => {
        let q = supabase
          .from("social_interactions")
          .select("id, comment_text, comment_author, sentiment_label, social_network, city, state, created_at, collected_at")
          .eq("user_id", userId)
          .eq("candidate_id", candidateId)
          .order("created_at", { ascending: false })
          .range(from, to);
        if (network !== ALL_NETWORKS_VALUE) {
          const def = NETWORKS.find((n) => n.label === network);
          if (def) q = q.in("social_network", def.values as any);
        }
        return q;
      });
      setRows(data);
      setTotalRecords(data.length);
    })();
  }, [userId, candidateId, network]);

  const cities = useMemo<CityAgg[]>(() => {
    if (!rows) return [];
    const map = new Map<string, CityAgg>();
    const cutoff7 = subDays(new Date(), 7).getTime();
    const cutoff14 = subDays(new Date(), 14).getTime();
    rows.forEach((r) => {
      let city = (r.city || "").trim();
      let uf: UF | null = (r.state || null) as UF | null;
      if (!city) {
        const inf = inferLocation(r.comment_text, r.comment_author);
        city = inf.city || "";
        uf = inf.uf || uf;
      }
      if (!city) return;
      const key = `${city.toLowerCase()}|${uf || ""}`;
      const agg = map.get(key) || { city, uf, total: 0, pos: 0, neg: 0, neu: 0, recent: 0, previous: 0 };
      agg.total++;
      const k = sentKey(r.sentiment_label);
      agg[k]++;
      const ts = new Date(r.collected_at || r.created_at || 0).getTime();
      if (ts >= cutoff7) agg.recent++;
      else if (ts >= cutoff14) agg.previous++;
      map.set(key, agg);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  // Invariante: Σ cidades ≤ totalRecords
  const sumCities = useMemo(() => cities.reduce((s, c) => s + c.total, 0), [cities]);
  const unidentified = Math.max(0, totalRecords - sumCities);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((c) => c.city.toLowerCase().includes(q) || (c.uf || "").toLowerCase().includes(q));
  }, [cities, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" /> Ranking por cidade
        </CardTitle>
        <CardDescription>
          {rows
            ? `${cities.length.toLocaleString("pt-BR")} cidades identificadas em ${totalRecords.toLocaleString("pt-BR")} menções`
            : "Carregando..."}
          {unidentified > 0 && (
            <> · {unidentified.toLocaleString("pt-BR")} sem geolocalização</>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : cities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sem dados de cidade disponíveis.</p>
        ) : (
          <>
            <Input
              placeholder="Buscar cidade ou UF..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="mb-3 max-w-sm"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Cidade</th>
                    <th className="py-2 pr-3">UF</th>
                    <th className="py-2 pr-3 text-right">Menções</th>
                    <th className="py-2 pr-3 text-right">Pos</th>
                    <th className="py-2 pr-3 text-right">Neg</th>
                    <th className="py-2 pr-3 text-right">Neu</th>
                    <th className="py-2 pr-3 text-right">Crescimento</th>
                    <th className="py-2 pr-3 text-right">Aceitação</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c, i) => {
                    const opin = c.pos + c.neg;
                    const acc = opin > 0 ? Math.round((c.pos / opin) * 100) : 50;
                    const growth = c.previous > 0 ? Math.round(((c.recent - c.previous) / c.previous) * 100) : c.recent > 0 ? 100 : 0;
                    return (
                      <tr key={`${c.city}-${c.uf}-${i}`} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium">{c.city}</td>
                        <td className="py-2 pr-3">{c.uf ? <Badge variant="outline">{c.uf}</Badge> : <span className="text-muted-foreground">?</span>}</td>
                        <td className="py-2 pr-3 text-right">{c.total.toLocaleString("pt-BR")}</td>
                        <td className="py-2 pr-3 text-right text-emerald-600">
                          <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{c.pos}</span>
                        </td>
                        <td className="py-2 pr-3 text-right text-rose-600">{c.neg}</td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">{c.neu}</td>
                        <td className="py-2 pr-3 text-right">
                          <span className={`inline-flex items-center gap-1 ${growth > 0 ? "text-emerald-600" : growth < 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                            {growth > 0 ? <TrendingUp className="h-3 w-3" /> : growth < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                            {growth > 0 ? "+" : ""}{growth}%
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right font-semibold">
                          <span className={acc > 60 ? "text-emerald-600" : acc < 40 ? "text-rose-600" : "text-amber-600"}>{acc}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                {filtered.length.toLocaleString("pt-BR")} cidades
                {filter && ` filtradas de ${cities.length.toLocaleString("pt-BR")}`}
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
