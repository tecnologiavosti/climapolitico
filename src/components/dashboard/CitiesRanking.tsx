import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, ThumbsUp, ThumbsDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { inferLocation, UF_NAME, type UF } from "@/lib/brazilStatesInference";
import { ALL_NETWORKS_VALUE, NETWORKS } from "@/pages/dashboard/regionalAnalysis.helpers";

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

  useEffect(() => {
    if (!userId || !candidateId) return;
    setRows(null);
    (async () => {
      let q = supabase
        .from("social_interactions")
        .select("id, comment_text, comment_author, sentiment_label, social_network, city, state")
        .eq("user_id", userId)
        .eq("candidate_id", candidateId)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (network !== ALL_NETWORKS_VALUE) {
        const def = NETWORKS.find((n) => n.label === network);
        if (def) q = q.in("social_network", def.values as any);
      }
      const { data } = await q;
      setRows(data || []);
    })();
  }, [userId, candidateId, network]);

  const cities = useMemo<CityAgg[]>(() => {
    if (!rows) return [];
    const map = new Map<string, CityAgg>();
    rows.forEach((r) => {
      let city = (r.city || "").trim();
      let uf: UF | null = (r.state || null) as UF | null;
      if (!city) {
        const inf = inferLocation(`${r.comment_text || ""} ${r.comment_author || ""}`);
        city = inf.city || "";
        uf = inf.uf || uf;
      }
      if (!city) return;
      const key = `${city.toLowerCase()}|${uf || ""}`;
      const agg = map.get(key) || { city, uf, total: 0, pos: 0, neg: 0, neu: 0 };
      agg.total++;
      const k = sentKey(r.sentiment_label);
      agg[k]++;
      map.set(key, agg);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((c) => c.city.toLowerCase().includes(q) || (c.uf || "").toLowerCase().includes(q));
  }, [cities, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Ranking por cidade</CardTitle>
        <CardDescription>
          Cidades com mais menções para este candidato.
          {rows && cities.length === 0 && " Nenhuma cidade detectada — aguarde mais coletas com geolocalização."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : cities.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sem dados de cidade disponíveis.</p>
        ) : (
          <>
            <Input placeholder="Filtrar cidade ou UF..." value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-sm" />
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
                    <th className="py-2 pr-3 text-right">Aceitação</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 50).map((c, i) => {
                    const opin = c.pos + c.neg;
                    const acc = opin > 0 ? Math.round((c.pos / opin) * 100) : 50;
                    return (
                      <tr key={`${c.city}-${c.uf}-${i}`} className="border-b hover:bg-muted/30">
                        <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium">{c.city}</td>
                        <td className="py-2 pr-3">{c.uf ? <Badge variant="outline">{c.uf}</Badge> : <span className="text-muted-foreground">?</span>}</td>
                        <td className="py-2 pr-3 text-right">{c.total}</td>
                        <td className="py-2 pr-3 text-right text-emerald-600 inline-flex items-center gap-1 justify-end w-full"><ThumbsUp className="h-3 w-3" />{c.pos}</td>
                        <td className="py-2 pr-3 text-right text-rose-600">{c.neg}</td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">{c.neu}</td>
                        <td className="py-2 pr-3 text-right font-semibold">
                          <span className={acc > 60 ? "text-emerald-600" : acc < 40 ? "text-rose-600" : "text-amber-600"}>{acc}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length > 50 && (
                <p className="text-xs text-muted-foreground mt-2">Exibindo top 50 de {filtered.length} cidades</p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
