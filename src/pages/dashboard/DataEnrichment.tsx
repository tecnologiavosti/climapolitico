import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { MapPin, Newspaper, Loader2, History, Globe } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function DataEnrichment() {
  const [enriching, setEnriching] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [enrichResult, setEnrichResult] = useState<any>(null);
  const [backfillResult, setBackfillResult] = useState<any>(null);
  const [months, setMonths] = useState<number[]>([6]);
  const [enrichLimit, setEnrichLimit] = useState(2000);

  const handleEnrich = async () => {
    setEnriching(true);
    const t = toast.loading(`Inferindo cidade/UF em até ${enrichLimit} interações...`);
    try {
      const { data, error } = await supabase.functions.invoke("enrich-interactions-location", {
        body: { limit: enrichLimit },
      });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(`Enriquecido: ${data?.enriched || 0} de ${data?.scanned || 0} interações`);
      setEnrichResult(data);
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Falha: ${e.message || e}`);
    } finally {
      setEnriching(false);
    }
  };

  const handleBackfill = async () => {
    setBackfilling(true);
    const t = toast.loading(`Buscando notícias dos últimos ${months[0]} meses na GDELT (pode demorar)...`);
    try {
      const { data, error } = await supabase.functions.invoke("historical-news-backfill", {
        body: { months: months[0] },
      });
      if (error) throw error;
      toast.dismiss(t);
      toast.success(`Backfill OK: ${data?.inserted || 0} linhas em historical_metrics`);
      setBackfillResult(data);
    } catch (e: any) {
      toast.dismiss(t);
      toast.error(`Falha: ${e.message || e}`);
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-7 w-7 text-primary" /> Enriquecimento de Dados
        </h1>
        <p className="text-muted-foreground">Ferramentas para inferir geolocalização nas menções e popular histórico de notícias passadas (GDELT).</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5 text-primary" /> Inferir cidade & UF</CardTitle>
            <CardDescription>
              Varre interações sem cidade/UF e detecta usando dicionário de cidades brasileiras (capitais + metrópoles) e siglas de UF no texto.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Quantidade a processar (máx 5000)</Label>
              <Input type="number" value={enrichLimit} onChange={(e) => setEnrichLimit(Math.min(5000, Math.max(100, Number(e.target.value))))} />
            </div>
            <Button onClick={handleEnrich} disabled={enriching} className="w-full">
              {enriching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Processando...</> : "Inferir agora"}
            </Button>
            {enrichResult && (
              <div className="text-sm space-y-1 p-3 bg-muted/40 rounded-lg">
                <div>Escaneadas: <Badge variant="secondary">{enrichResult.scanned}</Badge></div>
                <div>Enriquecidas: <Badge className="bg-emerald-500/15 text-emerald-700">{enrichResult.enriched}</Badge></div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Limitação: cidades pequenas que não estão no dicionário ficarão sem detecção. Para coletas futuras, os coletores precisam preencher city/state na inserção.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Newspaper className="h-5 w-5 text-primary" /> Histórico de notícias (GDELT)</CardTitle>
            <CardDescription>
              Busca menções em mídia tradicional brasileira nos últimos N meses via GDELT 2.0 (gratuito, sem chave) e popula <code>historical_metrics</code> para comparativos temporais.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Meses para trás: <strong>{months[0]}</strong></Label>
              <Slider value={months} onValueChange={setMonths} min={1} max={12} step={1} className="mt-2" />
              <p className="text-xs text-muted-foreground mt-1">Cada mês = ~1 chamada GDELT por candidato (delay 400ms entre chamadas).</p>
            </div>
            <Button onClick={handleBackfill} disabled={backfilling} className="w-full">
              {backfilling ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Buscando...</> : `Rodar backfill (${months[0]} meses)`}
            </Button>
            {backfillResult && (
              <div className="text-sm space-y-1 p-3 bg-muted/40 rounded-lg">
                <div>Linhas inseridas: <Badge className="bg-emerald-500/15 text-emerald-700">{backfillResult.inserted}</Badge></div>
                {Array.isArray(backfillResult.summary) && backfillResult.summary.map((s: any, i: number) => (
                  <div key={i} className="text-xs">{s.candidate}: {s.days} dias</div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground flex items-start gap-1.5">
              <Globe className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              GDELT cobre mídia tradicional (TV, jornais, portais) — não substitui dados de redes sociais, mas permite IA temporal comparar com períodos anteriores ao cadastro do candidato.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
