import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MapPin, ThumbsUp, TrendingUp, TrendingDown, ShieldCheck, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  userId: string;
  candidateId: string;
  network: string;
}

interface CityAgg {
  city: string;
  uf: string | null;
  total: number;
  pos: number;
  neg: number;
  neu: number;
  recent: number;
  previous: number;
  confidence?: "high" | "low" | null;
}

interface SummaryResp {
  cities: CityAgg[];
  totalRecords: number;
  withCity: number;
  withState: number;
  withRegion: number;
  withoutCity: number;
  withoutLocation: number;
  lowConfidence: number;
  citiesCount: number;
  statesCount: number;
  regionsCount: number;
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{typeof value === "number" ? value.toLocaleString("pt-BR") : value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

export default function CitiesRanking({ userId, candidateId }: Props) {
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!userId || !candidateId) return;
    setSummary(null);
    setError(null);
    (async () => {
      const t0 = performance.now();
      const { data, error } = await supabase.rpc("get_cities_ranking_summary" as any, {
        _user_id: userId,
        _candidate_id: candidateId,
      });
      const ms = Math.round(performance.now() - t0);
      if (error) {
        console.warn(`[CitiesRanking] RPC falhou em ${ms}ms`, error);
        setError(error.message || "Falha ao carregar cidades");
        return;
      }
      console.log(`[CitiesRanking] RPC OK em ${ms}ms`, data);
      setSummary(data as SummaryResp);
    })();
  }, [userId, candidateId]);

  const cities = summary?.cities ?? [];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return cities;
    return cities.filter((c) => c.city.toLowerCase().includes(q) || (c.uf || "").toLowerCase().includes(q));
  }, [cities, filter]);

  const coverage = summary && summary.totalRecords > 0
    ? Math.round((summary.withRegion / summary.totalRecords) * 1000) / 10
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" /> Ranking por cidade
        </CardTitle>
        <CardDescription>
          {summary
            ? `${summary.citiesCount.toLocaleString("pt-BR")} cidades · ${summary.statesCount}/27 estados · ${summary.regionsCount}/5 regiões`
            : "Carregando..."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary === null ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : error ? (
          <p className="text-sm text-destructive text-center py-6">Não foi possível carregar: {error}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
              <Metric label="Cobertura" value={`${coverage}%`} sub="menções com região" />
              <Metric label="Cidades" value={summary.citiesCount} />
              <Metric label="Estados" value={`${summary.statesCount}/27`} />
              <Metric label="Sem localização" value={summary.withoutLocation} />
              <Metric label="Baixa confiança" value={summary.lowConfidence} sub="inferido do texto" />
            </div>

            {cities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Sem dados de cidade disponíveis para este candidato.</p>
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
                        <th className="py-2 pr-3">Cidade/UF</th>
                        <th className="py-2 pr-3 text-right">Menções</th>
                        <th className="py-2 pr-3 text-right">Pos</th>
                        <th className="py-2 pr-3 text-right">Neg</th>
                        <th className="py-2 pr-3 text-right">Neu</th>
                        <th className="py-2 pr-3 text-right">Crescimento (7d × 7d)</th>
                        <th className="py-2 pr-3 text-right">Aceitação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((c, i) => {
                        const opin = c.pos + c.neg;
                        const acc = opin > 0 ? Math.round((c.pos / opin) * 100) : null;
                        let growthDisplay: { txt: string; cls: string; Icon: typeof TrendingUp | null } = { txt: "—", cls: "text-muted-foreground", Icon: null };
                        if (c.previous > 0) {
                          const pct = Math.round(((c.recent - c.previous) / c.previous) * 100);
                          growthDisplay = {
                            txt: `${pct > 0 ? "+" : ""}${pct}%`,
                            cls: pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-muted-foreground",
                            Icon: pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : null,
                          };
                        } else if (c.recent > 0) {
                          growthDisplay = { txt: "Novo", cls: "text-emerald-600", Icon: TrendingUp };
                        }
                        const Conf = c.confidence === "low" ? ShieldAlert : ShieldCheck;
                        const confCls = c.confidence === "low" ? "text-amber-600" : "text-emerald-600";
                        const confTitle = c.confidence === "low" ? "Baixa confiança (inferido do texto)" : "Alta confiança";
                        return (
                          <tr key={`${c.city}-${c.uf}-${i}`} className="border-b hover:bg-muted/30">
                            <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                            <td className="py-2 pr-3 font-medium">
                              <span className="inline-flex items-center gap-2">
                                <Conf className={`h-3.5 w-3.5 ${confCls}`} aria-label={confTitle} />
                                {c.city}
                                {c.uf && <Badge variant="outline" className="font-mono text-[10px]">{c.uf}</Badge>}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right">{c.total.toLocaleString("pt-BR")}</td>
                            <td className="py-2 pr-3 text-right text-emerald-600">
                              <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{c.pos.toLocaleString("pt-BR")}</span>
                            </td>
                            <td className="py-2 pr-3 text-right text-rose-600">{c.neg.toLocaleString("pt-BR")}</td>
                            <td className="py-2 pr-3 text-right text-muted-foreground">{c.neu.toLocaleString("pt-BR")}</td>
                            <td className="py-2 pr-3 text-right">
                              <span className={`inline-flex items-center gap-1 ${growthDisplay.cls}`}>
                                {growthDisplay.Icon ? <growthDisplay.Icon className="h-3 w-3" /> : null}
                                {growthDisplay.txt}
                              </span>
                            </td>
                            <td className="py-2 pr-3 text-right font-semibold">
                              {acc === null ? (
                                <span className="text-muted-foreground">—</span>
                              ) : (
                                <span className={acc > 60 ? "text-emerald-600" : acc < 40 ? "text-rose-600" : "text-amber-600"}>{acc}%</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="text-xs text-muted-foreground mt-2">
                    {filtered.length.toLocaleString("pt-BR")} cidades
                    {filter && ` filtradas de ${cities.length.toLocaleString("pt-BR")}`}
                    {" · "}{summary.totalRecords.toLocaleString("pt-BR")} menções analisadas
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
