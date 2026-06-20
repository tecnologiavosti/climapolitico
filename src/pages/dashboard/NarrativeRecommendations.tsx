import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { DateRangePicker } from "@/components/DateRangePicker";
import { InfoTip } from "@/components/ui/info-tip";
import {
  Sparkles, Target, Megaphone, AlertTriangle, Zap, Brain, Wand2, Send,
  Loader2, CheckCircle2, Instagram, Music2, Mic2, Tv, MapPin, Flame,
} from "lucide-react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { toast } from "sonner";
import type { DateRange } from "react-day-picker";

interface DNA {
  emocao: number; autoridade: number; carisma: number;
  confianca: number; combatividade: number; proximidade: number;
}
interface Recommendations {
  central_narrative: string;
  archetype: string;
  archetype_rationale: string;
  public_perception: string;
  ideological_position: string;
  emotional_force: number;
  narrative_dna: DNA;
  narrative_gaps: { topic: string; opportunity: string; why: string }[];
  high_conversion_narratives: { narrative: string; score: number; target_audience: string; rationale: string }[];
  harmful_narratives: { narrative: string; risk: string; mitigation: string }[];
  channel_plan: Record<string, { strategy: string; tone: string; content_examples: string[] }>;
  confidence: number;
}

const PERIOD_OPTIONS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
  { value: "365", label: "Último ano" },
  { value: "custom", label: "Personalizado" },
];

const LOADING_STAGES = [
  "Analisando posicionamento",
  "Detectando arquétipo",
  "Mapeando riscos",
  "Gerando narrativas",
  "Finalizando estratégia",
];

const CHANNEL_META: Record<string, { label: string; icon: any; gradient: string }> = {
  instagram: { label: "Instagram", icon: Instagram, gradient: "from-pink-500/20 to-purple-500/20" },
  tiktok:    { label: "TikTok",    icon: Music2,    gradient: "from-rose-500/20 to-cyan-500/20" },
  debates:   { label: "Debates",   icon: Mic2,      gradient: "from-amber-500/20 to-orange-500/20" },
  tv:        { label: "TV",        icon: Tv,        gradient: "from-blue-500/20 to-indigo-500/20" },
  interior:  { label: "Interior",  icon: MapPin,    gradient: "from-emerald-500/20 to-teal-500/20" },
};

const SPEECH_TONES = [
  { key: "tecnico",      label: "Técnico" },
  { key: "emocional",    label: "Emocional" },
  { key: "agressivo",    label: "Agressivo" },
  { key: "presidencial", label: "Presidencial" },
  { key: "popular",      label: "Popular" },
];

const glass =
  "backdrop-blur-xl bg-white/5 dark:bg-white/[0.03] border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.12)]";

function ScoreBar({ value, color = "from-blue-500 to-violet-500" }: { value: number; color?: string }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        transition={{ duration: 0.9, ease: "easeOut" }}
        className={`h-full bg-gradient-to-r ${color}`}
      />
    </div>
  );
}

function LoadingStages() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => Math.min(s + 1, LOADING_STAGES.length)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <Card className={glass}>
      <CardContent className="py-8 space-y-5">
        <Progress value={(step / LOADING_STAGES.length) * 100} className="h-1.5" />
        <ul className="space-y-2">
          {LOADING_STAGES.map((s, i) => (
            <motion.li
              key={s}
              initial={{ opacity: 0.3, x: -8 }}
              animate={{ opacity: i < step ? 1 : 0.4, x: i < step ? 0 : -4 }}
              className="flex items-center gap-3 text-sm"
            >
              {i < step ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : i === step ? (
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
              ) : (
                <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />
              )}
              <span className={i < step ? "text-foreground" : "text-muted-foreground"}>{s}</span>
            </motion.li>
          ))}
        </ul>
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

const NarrativeRecommendationsPage = () => {
  const { user } = useAuth();
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedPeriod, setSelectedPeriod] = useState("7");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [result, setResult] = useState<{
    recommendations: Recommendations | null; fallback?: boolean; message?: string;
    candidate?: any; period?: any; ai_provider?: string;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [phrase, setPhrase] = useState("");
  const [phraseEval, setPhraseEval] = useState<any>(null);
  const [evaluating, setEvaluating] = useState(false);

  const [speech, setSpeech] = useState<any>(null);
  const [speechLoading, setSpeechLoading] = useState<string>("");

  const { data: candidates = [] } = useQuery({
    queryKey: ["candidates-narr", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("candidates").select("id, full_name, party").order("full_name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  const handleGenerate = async () => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    setIsLoading(true); setResult(null); setPhraseEval(null); setSpeech(null);
    try {
      const payload: any = { mode: "full", candidateId: selectedCandidate };
      if (selectedPeriod === "custom" && dateRange?.from && dateRange?.to) {
        payload.startDate = dateRange.from.toISOString();
        payload.endDate = dateRange.to.toISOString();
      } else {
        payload.daysBack = parseInt(selectedPeriod) || 7;
      }
      const { data, error } = await supabase.functions.invoke(
        "generate-narrative-recommendations", { body: payload }
      );
      if (error) throw error;
      setResult(data);
      if (data?.fallback || !data?.recommendations) {
        toast.error(data?.message || "IA temporariamente indisponível");
      } else {
        toast.success("Recomendações geradas!");
      }
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Erro ao gerar");
    } finally {
      setIsLoading(false);
    }
  };

  const evaluatePhrase = async () => {
    if (!phrase.trim() || !selectedCandidate) return;
    setEvaluating(true); setPhraseEval(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-narrative-recommendations",
        { body: { mode: "evaluate_phrase", candidateId: selectedCandidate, phrase } }
      );
      if (error) throw error;
      if (data?.evaluation) setPhraseEval(data.evaluation);
      else toast.error(data?.message || "Não foi possível avaliar");
    } catch (e: any) {
      toast.error(e.message || "Erro");
    } finally {
      setEvaluating(false);
    }
  };

  const generateSpeech = async (tone: string) => {
    if (!selectedCandidate) { toast.error("Selecione um candidato"); return; }
    setSpeechLoading(tone); setSpeech(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "generate-narrative-recommendations",
        { body: { mode: "generate_speech", candidateId: selectedCandidate, tone, topic: rec?.central_narrative || "visão de futuro" } }
      );
      if (error) throw error;
      if (data?.speech) setSpeech({ tone, ...data.speech });
      else toast.error(data?.message || "Falha ao gerar discurso");
    } catch (e: any) {
      toast.error(e.message || "Erro");
    } finally {
      setSpeechLoading("");
    }
  };

  const rec = result?.recommendations;

  const radarData = useMemo(() => {
    if (!rec?.narrative_dna) return [];
    const d = rec.narrative_dna;
    return [
      { dim: "Emoção", v: d.emocao },
      { dim: "Autoridade", v: d.autoridade },
      { dim: "Carisma", v: d.carisma },
      { dim: "Confiança", v: d.confianca },
      { dim: "Combatividade", v: d.combatividade },
      { dim: "Proximidade", v: d.proximidade },
    ];
  }, [rec]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-400 via-blue-400 to-cyan-400 bg-clip-text text-transparent">
          Recomendações de Narrativa
        </h1>
        <p className="text-muted-foreground mt-1">
          Engine estratégica 100% IA — arquétipo, percepção, gaps e potencial de conversão eleitoral.
        </p>
      </div>

      {/* Controls */}
      <Card className={glass}>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <Select value={selectedCandidate} onValueChange={setSelectedCandidate}>
              <SelectTrigger className="w-[260px]"><SelectValue placeholder="Selecione um candidato" /></SelectTrigger>
              <SelectContent>
                {candidates.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.full_name}{c.party ? ` (${c.party})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedPeriod === "custom" && (
              <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} className="w-[320px]" />
            )}

            <Button
              onClick={handleGenerate}
              disabled={isLoading || !selectedCandidate}
              className="bg-gradient-to-r from-violet-600 to-blue-600 hover:opacity-90"
            >
              {isLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Gerando...</>) :
                (<><Sparkles className="mr-2 h-4 w-4" />Gerar Recomendações</>)}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading && <LoadingStages />}

      {result && !rec && !isLoading && (
        <Card className={glass}>
          <CardContent className="py-12 text-center">
            <AlertTriangle className="h-10 w-10 mx-auto text-amber-400 mb-3" />
            <p className="text-muted-foreground">{result.message || "Sem dados."}</p>
          </CardContent>
        </Card>
      )}

      <AnimatePresence>
        {rec && (
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            {/* Central Narrative */}
            <Card className={`${glass} border-violet-500/30`}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <Target className="h-7 w-7 text-violet-400 mt-1 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs uppercase tracking-wider text-violet-300">Narrativa Central Recomendada</span>
                      <Badge variant="outline" className="border-violet-500/40 text-violet-300">
                        Arquétipo: {rec.archetype}
                      </Badge>
                      <Badge variant="outline" className="ml-auto">
                        Confiança IA: {Math.round(rec.confidence ?? 0)}%
                      </Badge>
                    </div>
                    <p className="text-xl font-semibold leading-snug">{rec.central_narrative}</p>
                    <div className="mt-4 grid gap-3 md:grid-cols-3 text-sm">
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Percepção pública</div>
                        <div>{rec.public_perception}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1">Posicionamento ideológico</div>
                        <div>{rec.ideological_position}</div>
                      </div>
                      <div className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                          Força emocional <InfoTip text="Intensidade emocional projetada pelo discurso atual do candidato." iconClassName="h-3 w-3" />
                        </div>
                        <div className="text-2xl font-bold">{Math.round(rec.emotional_force ?? 0)}</div>
                        <ScoreBar value={rec.emotional_force ?? 0} color="from-rose-500 to-amber-500" />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* DNA Radar + Vacuums */}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-cyan-400" /> Radar DNA Narrativo
                  </CardTitle>
                  <CardDescription>Perfil de comunicação em 6 dimensões.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="hsl(var(--border))" />
                        <PolarAngleAxis dataKey="dim" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                        <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                        <Radar name="DNA" dataKey="v" stroke="#a78bfa" fill="#a78bfa" fillOpacity={0.4} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className={glass}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Flame className="h-5 w-5 text-amber-400" /> Vácuos Narrativos
                  </CardTitle>
                  <CardDescription>Oportunidades pouco exploradas com alto retorno.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {rec.narrative_gaps?.map((g, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
                      className="rounded-lg border border-white/10 p-3 hover:border-amber-500/40 transition-colors"
                    >
                      <div className="font-semibold">{g.topic}</div>
                      <div className="text-sm text-muted-foreground mt-1">{g.opportunity}</div>
                      <div className="text-xs text-amber-300/80 mt-2">Por quê: {g.why}</div>
                    </motion.div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Conversion narratives */}
            <Card className={`${glass} border-emerald-500/20`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-300">
                  <Megaphone className="h-5 w-5" /> Narrativas com Maior Potencial de Conversão
                </CardTitle>
                <CardDescription>Score 0–100 estimado pela IA para mover indecisos.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {rec.high_conversion_narratives?.map((n, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
                    className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 hover:bg-emerald-500/[0.08] transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">{n.narrative}</span>
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">{Math.round(n.score)}</Badge>
                    </div>
                    <ScoreBar value={n.score} color="from-emerald-500 to-teal-400" />
                    <div className="text-xs text-muted-foreground mt-2">🎯 {n.target_audience}</div>
                    <div className="text-sm mt-2">{n.rationale}</div>
                  </motion.div>
                ))}
              </CardContent>
            </Card>

            {/* Harmful narratives */}
            <Card className={`${glass} border-rose-500/20`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-rose-300">
                  <AlertTriangle className="h-5 w-5" /> Narrativas que Prejudicam
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {rec.harmful_narratives?.map((h, i) => (
                  <div key={i} className="rounded-lg border border-rose-500/20 p-4 bg-rose-500/[0.04]">
                    <div className="font-semibold">{h.narrative}</div>
                    <div className="text-sm mt-1"><span className="text-rose-300">Risco:</span> {h.risk}</div>
                    <div className="text-sm mt-1"><span className="text-emerald-300">Mitigação:</span> {h.mitigation}</div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Phrase simulator */}
            <Card className={glass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5 text-yellow-400" /> Simulador de Frases
                </CardTitle>
                <CardDescription>Digite uma frase e veja como a IA a avalia.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  placeholder='Ex: "O nosso estado merece coragem para mudar de verdade..."'
                  className="min-h-[90px]"
                />
                <div className="flex justify-end">
                  <Button onClick={evaluatePhrase} disabled={evaluating || !phrase.trim()} size="sm">
                    {evaluating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Avaliando...</> :
                      <><Send className="h-4 w-4 mr-2" />Avaliar</>}
                  </Button>
                </div>
                {phraseEval && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid gap-3 md:grid-cols-4">
                    {(["clareza","emocao","persuasao","viralizacao"] as const).map((k) => (
                      <div key={k} className="rounded-lg border border-white/10 p-3">
                        <div className="text-xs text-muted-foreground capitalize">{k}</div>
                        <div className="text-2xl font-bold">{Math.round(phraseEval.scores?.[k] ?? 0)}</div>
                        <ScoreBar value={phraseEval.scores?.[k] ?? 0} />
                      </div>
                    ))}
                    {phraseEval.improved_version && (
                      <div className="md:col-span-4 rounded-lg border border-violet-500/30 bg-violet-500/[0.05] p-3">
                        <div className="text-xs text-violet-300 mb-1">Versão otimizada pela IA</div>
                        <div className="text-sm">{phraseEval.improved_version}</div>
                        {phraseEval.why && <div className="text-xs text-muted-foreground mt-2">{phraseEval.why}</div>}
                      </div>
                    )}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* Speech generator */}
            <Card className={glass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wand2 className="h-5 w-5 text-fuchsia-400" /> Gerador de Discurso
                </CardTitle>
                <CardDescription>Escolha o tom e a IA escreve um discurso pronto.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {SPEECH_TONES.map((t) => (
                    <Button
                      key={t.key}
                      variant="outline"
                      size="sm"
                      onClick={() => generateSpeech(t.key)}
                      disabled={!!speechLoading}
                      className="border-fuchsia-500/30 hover:bg-fuchsia-500/10"
                    >
                      {speechLoading === t.key ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                      {t.label}
                    </Button>
                  ))}
                </div>
                {speech && (
                  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-white/10 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold">{speech.title}</div>
                      <Badge variant="outline">Tom: {speech.tone}</Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{speech.speech}</p>
                    {speech.hooks?.length > 0 && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {speech.hooks.map((h: string, i: number) => (
                          <div key={i} className="rounded border border-fuchsia-500/30 bg-fuchsia-500/[0.05] p-2 text-xs">{h}</div>
                        ))}
                      </div>
                    )}
                    {speech.recommended_channel && (
                      <div className="mt-3 text-xs text-muted-foreground">📡 Canal recomendado: <strong>{speech.recommended_channel}</strong></div>
                    )}
                  </motion.div>
                )}
              </CardContent>
            </Card>

            {/* Channel plan */}
            <Card className={glass}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-400" /> Plano de Comunicação por Canal
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(rec.channel_plan || {}).map(([k, v], i) => {
                  const meta = CHANNEL_META[k] || { label: k, icon: Target, gradient: "from-blue-500/20 to-violet-500/20" };
                  const Icon = meta.icon;
                  return (
                    <motion.div
                      key={k}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      className={`rounded-xl border border-white/10 p-4 bg-gradient-to-br ${meta.gradient} hover:scale-[1.02] transition-transform`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className="h-5 w-5" />
                        <span className="font-semibold">{meta.label}</span>
                        <Badge variant="outline" className="ml-auto text-xs">{v.tone}</Badge>
                      </div>
                      <p className="text-sm mb-3">{v.strategy}</p>
                      <ul className="space-y-1">
                        {v.content_examples?.map((ex, j) => (
                          <li key={j} className="text-xs text-muted-foreground flex gap-2">
                            <span className="text-blue-300">▸</span><span>{ex}</span>
                          </li>
                        ))}
                      </ul>
                    </motion.div>
                  );
                })}
              </CardContent>
            </Card>

            <div className="text-xs text-muted-foreground text-right">
              Gerado por IA · {result?.ai_provider}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NarrativeRecommendationsPage;
