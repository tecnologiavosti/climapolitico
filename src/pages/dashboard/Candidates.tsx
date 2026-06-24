import { HelpTooltip } from "@/components/ui/help-tooltip";
import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, UserPlus, Trash2, Brain, Loader2, Youtube, ChevronDown, ChevronUp, BarChart3, RefreshCw, Twitter, MessageCircle, Send, MessagesSquare, Newspaper, Music2, Wand2 } from "lucide-react";
// ArrowUpRight, ArrowDownRight, Minus removidos temporariamente (coluna Tendência oculta)
import { CandidateOverviewPanel } from "@/components/dashboard/CandidateOverviewPanel";
import { AddCandidateDialog, type AddCandidatePayload } from "@/components/dashboard/AddCandidateDialog";
import { findDuplicateCandidate, type DuplicateMatch } from "@/lib/candidateNameNormalizer";

// Zod validation schema
const urlOpt = z.string().trim().refine((val) => !val || val.startsWith("http://") || val.startsWith("https://"), {
  message: "Link deve começar com http:// ou https://"
}).optional().or(z.literal(""));

const candidateSchema = z.object({
  fullName: z.string().trim().min(3, "Nome deve ter no mínimo 3 caracteres").max(100, "Nome deve ter no máximo 100 caracteres"),
  region: z.string().trim().max(50, "Região deve ter no máximo 50 caracteres").optional().or(z.literal("")),
  socialMedia: urlOpt,
  instagramUrl: urlOpt,
  facebookUrl: urlOpt,
});


function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function resolveInitialMetadata(data: { fullName: string; region?: string }) {
  const name = normalizeText(data.fullName);
  const region = normalizeText(data.region ?? "");
  const isLula = name.includes("lula") || name.includes("luiz inacio lula da silva");
  const isNational = isLula || region.includes("brasil") || region.includes("nacional") ||
    ["bolsonaro", "ciro", "marina silva", "tarcisio"].some((n) => name.includes(n));

  return {
    region: isNational ? "Brasil" : (data.region?.trim() || null),
    party: isLula ? "PT" : null,
  };
}

export default function Candidates() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [candidateToDelete, setCandidateToDelete] = useState<string | null>(null);
  const [expandedCandidate, setExpandedCandidate] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [duplicateMatch, setDuplicateMatch] = useState<
    | { match: DuplicateMatch<{ id: string; full_name: string }>; payload: AddCandidatePayload }
    | null
  >(null);

  // Open add-candidate dialog automatically when navigated with ?add=1 (from sidebar)
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get("add") === "1") {
      setDialogOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("add");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Fetch user's subscription
  const { data: subscription } = useQuery({
    queryKey: ['subscription'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();
      
      if (error) throw error;
      return data;
    },
  });

  // Fetch candidates
  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ['candidates'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('candidates')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data;
    },
  });

  // Add candidate mutation
  const addCandidateMutation = useMutation({
    mutationFn: async (payload: AddCandidatePayload) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuário não autenticado');

      const isNationalPosition = payload.position === 'Presidente';
      const inferred = resolveInitialMetadata({ fullName: payload.fullName, region: payload.state });
      const regionFinal = isNationalPosition
        ? 'Brasil'
        : (inferred.region || `${payload.state} — ${payload.region}`);

      const tiktokLink = payload.socials.tiktok?.trim() || null;

      const { data, error } = await supabase
        .from('candidates')
        .insert({
          user_id: user.id,
          full_name: payload.fullName,
          region: regionFinal,
          party: payload.party || inferred.party,
          social_media_link: tiktokLink,
        })
        .select()
        .single();

      if (error) throw error;

      // Extra social links
      const extras: Array<{ candidate_id: string; user_id: string; platform: string; url: string; handle: string | null }> = [];
      const pushLink = (platform: string, url: string, re: RegExp) => {
        if (!url) return;
        const m = url.match(re);
        extras.push({ candidate_id: data.id, user_id: user.id, platform, url, handle: m?.[1] ?? null });
      };
      pushLink('instagram', payload.socials.instagram, /instagram\.com\/([A-Za-z0-9_.]+)/i);
      pushLink('facebook', payload.socials.facebook, /facebook\.com\/([A-Za-z0-9.\-]+)/i);
      pushLink('twitter', payload.socials.twitter, /(?:twitter|x)\.com\/([A-Za-z0-9_]+)/i);
      pushLink('youtube', payload.socials.youtube, /youtube\.com\/(?:@|c\/|channel\/|user\/)?([A-Za-z0-9_\-]+)/i);
      if (extras.length > 0) {
        const { error: linksErr } = await supabase.from('candidate_social_links').insert(extras);
        if (linksErr) console.error('Erro ao salvar links extras:', linksErr);
      }

      const bootstrap = await supabase.functions.invoke('recalculate-candidate-metrics', {
        body: { candidateId: data.id, wait: true, bootstrap: true },
      });
      if (bootstrap.error) throw new Error(bootstrap.error.message ?? 'Falha ao inicializar métricas');

      const comparison = await supabase.functions.invoke('ai-candidate-comparison', {
        body: { period: '30d' },
      });
      if (comparison.error) throw new Error(comparison.error.message ?? 'Falha ao recalcular comparação');

      const narrative = await supabase.functions.invoke('generate-candidate-summary', {
        body: { candidateId: data.id, daysBack: 'all' },
      });
      if (narrative.error) throw new Error(narrative.error.message ?? 'Falha ao gerar narrativa inicial');

      return data;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      toast.success('Candidato adicionado e métricas iniciais processadas!');
      setDialogOpen(false);
      setValidationErrors({});

      // Geração automática de canais/subreddits/keywords via IA (não bloqueante)
      try {
        const { data: cfg, error: cfgErr } = await supabase.functions.invoke('suggest-candidate-config', {
          body: {
            candidateName: data.full_name,
            party: data.party ?? '',
            region: data.region ?? '',
          },
        });
        if (!cfgErr && cfg) {
          const t = cfg.canais_telegram?.length ?? 0;
          const s = cfg.subreddits?.length ?? 0;
          const k = cfg.keywords?.length ?? 0;
          toast.success(`IA sugeriu ${t} canais Telegram, ${s} subreddits e ${k} keywords para monitorar.`, {
            duration: 6000,
          });
          console.log('[Candidates] IA sugestões:', cfg);
        }
      } catch (e) {
        console.warn('[Candidates] IA suggestions falharam (não bloqueante):', e);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erro ao adicionar candidato');
    }
  });

  // Delete candidate mutation — cascade remove all derived data + caches
  const deleteCandidateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('delete_candidate_cascade' as any, {
        _candidate_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      // Invalidate every cached query so dashboards, analytics, radar,
      // notifications, rankings, etc. refetch without the removed candidate.
      queryClient.invalidateQueries();
      toast.success('Candidato removido com sucesso!');
      setDeleteDialogOpen(false);
      setCandidateToDelete(null);
    },
    onError: (error) => {
      toast.error('Erro ao remover candidato');
      console.error('Delete error:', error);
    },
  });

  // Analyze candidate mutation
  const analyzeCandidateMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      if (!subscription) throw new Error('Subscription not found');
      
      if (subscription.updates_used_this_month >= subscription.max_updates_per_month) {
        throw new Error('Limite mensal de análises atingido');
      }

      const { data, error } = await supabase.functions.invoke('analyze-candidate', {
        body: { candidateId }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      toast.success(`Análise concluída! Sentimento: ${data.analysis.sentiment} (${data.analysis.sentimentScore}%)`);
    },
    onError: (error: Error) => {
      if (error.message.includes('Rate limit')) {
        toast.error('Limite de análises excedido. Aguarde 1 minuto.');
      } else if (error.message.includes('credits exhausted')) {
        toast.error('Créditos de IA esgotados. Adicione mais créditos.');
      } else if (error.message.includes('Limite mensal')) {
        toast.error('Limite mensal atingido. Faça upgrade do plano.');
      } else {
        toast.error('Erro ao analisar candidato. Tente novamente.');
      }
      console.error('Analysis error:', error);
    },
  });

  // YouTube collection mutation
  const youtubeCollectionMutation = useMutation({
    mutationFn: async ({ candidateId, candidateName }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('search-youtube-mentions', {
        body: {
          candidateId,
          candidateName
        }
      });

      if (error) throw error;
      if (data?.fallback) return data;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });

      const newComments = data?.stats?.newCommentsCollected ?? data?.stats?.commentsCollected ?? 0;
      const skipped = data?.stats?.skippedDuplicates ?? 0;
      const total = data?.stats?.totalCommentsInDatabase;
      toast.success(
        `YouTube: +${newComments} novos comentários (${skipped} duplicados). Total: ${typeof total === 'number' ? total : '—'}.`,
        { duration: 5000 }
      );
    },
    onSettled: () => {
      // Mesmo que o browser acuse “Failed to fetch”, a coleta pode ter concluído no backend.
      // Forçamos um refresh para sincronizar a contagem de menções.
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
    },
    onError: (error: Error) => {
      console.error('YouTube collection error:', error);
      const msg = (error?.message || '').toLowerCase();
      if (msg.includes('failed to fetch') || msg.includes('functionsfetcherror')) {
        toast.error('A conexão falhou durante a coleta. Vou atualizar a lista — em alguns casos a coleta termina mesmo assim.', {
          duration: 7000,
        });
      } else {
        toast.error('Erro ao coletar dados do YouTube: ' + error.message);
      }
    },
  });

  // Twitter/X collection mutation
  const twitterCollectionMutation = useMutation({
    mutationFn: async ({ candidateId, candidateName }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('search-twitter-mentions', {
        body: { candidateId, candidateName, maxTweets: 200, maxPages: 4 }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      const inserted = data?.inserted ?? 0;
      const total = data?.totalFound ?? 0;
      toast.success(
        `Twitter/X: +${inserted} tweets coletados (${total} encontrados).`,
        { duration: 5000 }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
    },
    onError: (error: Error) => {
      console.error('Twitter collection error:', error);
      toast.error('Erro ao coletar dados do Twitter/X: ' + error.message);
    },
  });

  // Reddit collection mutation
  const redditCollectionMutation = useMutation({
    mutationFn: async ({ candidateId, candidateName }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('search-reddit-mentions', {
        body: { candidateId, candidateName }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      const inserted = data?.inserted ?? data?.collected ?? data?.total_collected ?? 0;
      toast.success(
        `Reddit: +${inserted} posts coletados.`,
        { duration: 5000 }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
    },
    onError: (error: Error) => {
      console.error('Reddit collection error:', error);
      toast.error('Erro ao coletar dados do Reddit: ' + error.message);
    },
  });

  // Telegram collection mutation
  const telegramCollectionMutation = useMutation({
    mutationFn: async ({ candidateId, candidateName }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('search-telegram-mentions', {
        body: { candidateId, candidateName }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      const inserted = data?.inserted ?? 0;
      const scanned = data?.channelsScanned ?? 0;
      toast.success(
        `Telegram: +${inserted} posts coletados (${scanned} canais varridos).`,
        { duration: 5000 }
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
    },
    onError: (error: Error) => {
      console.error('Telegram collection error:', error);
      toast.error('Erro ao coletar dados do Telegram: ' + error.message);
    },
  });

  // Google News collection mutation (RSS oficial, sem API key)
  const googleNewsCollectionMutation = useMutation({
    mutationFn: async ({ candidateId, candidateName }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('search-google-news', {
        body: { candidateId, candidateName }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data, vars) => {
      try {
        await supabase.functions.invoke('recalculate-candidate-metrics', { body: { candidateId: vars.candidateId } });
      } catch (e) { console.warn('recalc falhou:', e); }
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
      queryClient.invalidateQueries({ queryKey: ['all-candidate-metrics-cache'] });
      const total = data?.total ?? data?.news?.length ?? 0;
      toast.success(`Google News: ${total} notícias coletadas e indexadas.`, { duration: 5000 });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
    },
    onError: (error: Error) => {
      console.error('Google News collection error:', error);
      toast.error('Erro ao coletar notícias do Google News: ' + error.message);
    },
  });

  // TikTok collection mutation (Urlebird scraping, sem API key)
  const tiktokCollectionMutation = useMutation({
    mutationFn: async ({ candidateId }: { candidateId: string; candidateName: string }) => {
      const { data, error } = await supabase.functions.invoke('tiktok-collector', {
        body: { candidateId }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async (data, vars) => {
      try {
        await supabase.functions.invoke('recalculate-candidate-metrics', { body: { candidateId: vars.candidateId } });
      } catch (e) { console.warn('recalc falhou:', e); }
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
      queryClient.invalidateQueries({ queryKey: ['all-candidate-metrics-cache'] });
      const posts = data?.posts ?? 0;
      const comments = data?.comments ?? 0;
      if (posts === 0 && comments === 0) {
        toast.info('TikTok: nenhum post novo encontrado. Verifique se o link social do candidato aponta para o perfil correto.', { duration: 6000 });
      } else {
        toast.success(`TikTok: +${posts} posts, +${comments} comentários coletados.`, { duration: 5000 });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-metrics-cache'] });
    },
    onError: (error: Error) => {
      console.error('TikTok collection error:', error);
      toast.error('Erro ao coletar dados do TikTok: ' + error.message);
    },
  });

  // Fila em lote para resolver @handles do TikTok automaticamente
  const tiktokResolveBatchMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('tiktok-resolve-batch', {
        body: { onlyMissing: true }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      if (data?.queued === 0) {
        toast.info(data?.message || 'Todos os candidatos já têm @handle do TikTok configurado.', { duration: 6000 });
      } else {
        toast.success(
          `Fila iniciada: ${data?.queued} candidatos serão processados em ~${data?.estimatedMinutes || 1} min. Você receberá uma notificação ao concluir.`,
          { duration: 8000 }
        );
      }
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error: Error) => {
      console.error('TikTok resolve batch error:', error);
      toast.error('Erro ao iniciar fila de resolução: ' + error.message);
    },
  });

  // Descobre automaticamente URLs de IG/FB para todos os candidatos
  const discoverSocialLinksMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('discover-social-links', { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const added = data?.added ?? 0;
      if (added === 0) {
        toast.info('Nenhum novo link encontrado (talvez todos já estejam configurados).', { duration: 6000 });
      } else {
        toast.success(`${added} link(s) de Instagram/Facebook descoberto(s) e salvo(s)!`, { duration: 6000 });
      }
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
    onError: (error: Error) => {
      toast.error('Erro ao descobrir links: ' + error.message);
    },
  });

  const backfillRepliesMutation = useMutation({
    mutationFn: async ({ candidateId }: { candidateId: string }) => {
      const { data, error } = await supabase.functions.invoke('backfill-replies', {
        body: { candidateId, days: 7, perNetworkLimit: 30 }
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      const s = data?.summary || {};
      const total = (s.Reddit?.replies || 0) + (s["Twitter/X"]?.replies || 0) + (s.Telegram?.replies || 0);
      toast.success(
        `Backfill concluído: +${total} comentários (Reddit ${s.Reddit?.replies || 0} | Twitter ${s["Twitter/X"]?.replies || 0} | Telegram ${s.Telegram?.replies || 0})`,
        { duration: 6000 }
      );
    },
    onError: (error: Error) => {
      console.error('Backfill error:', error);
      toast.error('Erro ao buscar comentários: ' + error.message);
    },
  });

  const reanalyzeSentimentMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('reanalyze-sentiment', {
        body: { batchSize: 50, maxToProcess: 500 }
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      queryClient.invalidateQueries({ queryKey: ['candidate-consolidated-metrics'] });
      const stats = data?.stats || {};
      toast.success(
        `Reprocessamento concluído! ${stats.processed || 0} comentários analisados, ${stats.updated || 0} corrigidos.`,
        { duration: 6000 }
      );
    },
    onError: (error: Error) => {
      console.error('Reanalyze sentiment error:', error);
      const msg = error.message || '';
      if (msg.includes('Rate limit') || msg.includes('429')) {
        toast.error('Rate limit do serviço de IA. Tente novamente em alguns minutos.');
      } else if (msg.includes('Créditos') || msg.includes('402')) {
        toast.error('Créditos de IA esgotados.');
      } else {
        toast.error('Erro ao reprocessar sentimento: ' + msg);
      }
    },
  });

  const handleAddCandidate = (payload: AddCandidatePayload) => {
    const match = findDuplicateCandidate(
      payload.fullName,
      (candidates ?? []).map((c: any) => ({ id: c.id, full_name: c.full_name })),
    );
    if (match) {
      if (match.exact) {
        toast.error(
          `Candidato já cadastrado: "${match.candidate.full_name}". Diferença apenas de acento/maiúsculas/pontuação.`,
        );
        return;
      }
      setDuplicateMatch({ match, payload });
      return;
    }
    addCandidateMutation.mutate(payload);
  };

  const filteredCandidates = candidates.filter((candidate) =>
    candidate.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (candidate.region && candidate.region.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const isLimitReached = false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="w-full sm:w-auto">
          <HelpTooltip text="Aqui você adiciona, remove e cuida dos candidatos que está acompanhando.">
            <h2 className="text-2xl sm:text-3xl font-bold">Candidatos</h2>
          </HelpTooltip>
          <p className="text-muted-foreground text-sm sm:text-base">
            Gerencie e monitore candidatos políticos
            <span className="ml-2 text-xs sm:text-sm">
              ({candidates.length} candidato{candidates.length === 1 ? '' : 's'})
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2 w-full sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none [&_button]:w-full sm:[&_button]:w-auto">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => reanalyzeSentimentMutation.mutate()}
                  disabled={reanalyzeSentimentMutation.isPending}
                >
                  {reanalyzeSentimentMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  )}
                  Corrigir Sentimento
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Reprocessar comentários classificados incorretamente como Neutro</p>
                <p className="text-xs text-muted-foreground">
                  Processa até 500 comentários por execução
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => tiktokResolveBatchMutation.mutate()}
                  disabled={tiktokResolveBatchMutation.isPending || candidates.length === 0}
                >
                  {tiktokResolveBatchMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="mr-2 h-4 w-4" />
                  )}
                  Resolver TikTok em Lote
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Descobrir o @handle do TikTok de todos os candidatos sem link configurado</p>
                <p className="text-xs text-muted-foreground">
                  Processa em background com rate-limit (~25/min) para evitar bloqueios
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => discoverSocialLinksMutation.mutate()}
                  disabled={discoverSocialLinksMutation.isPending || candidates.length === 0}
                >
                  {discoverSocialLinksMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="mr-2 h-4 w-4" />
                  )}
                  Descobrir IG/FB
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Descobre automaticamente Instagram e Facebook dos candidatos via busca</p>
                <p className="text-xs text-muted-foreground">Resultados são salvos em links extras e usados pelo coletor Apify</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <AddCandidateDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            isPending={addCandidateMutation.isPending}
            onSubmit={handleAddCandidate}
            trigger={
              <Button title="Cadastra um novo candidato pra você começar a acompanhar.">
                <UserPlus className="mr-2 h-4 w-4" />
                Adicionar Candidato
              </Button>
            }
          />
        </div>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <HelpTooltip text="Digite aqui pra achar um candidato pelo nome ou pela região.">
            <Input
              placeholder="Buscar por nome ou região..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </HelpTooltip>
        </div>
      </Card>

      {/* Candidates Table */}
      <Card>
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Candidato</TableHead>
                <TableHead className="hidden sm:table-cell">Menções</TableHead>
                <TableHead>Sentimento</TableHead>
                <TableHead className="hidden md:table-cell">Última Coleta</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCandidates.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    {searchTerm 
                      ? "Nenhum candidato encontrado com esse critério de busca"
                      : "Nenhum candidato cadastrado. Adicione seu primeiro candidato!"}
                  </TableCell>
                </TableRow>
              ) : (
                filteredCandidates.map((candidate) => {
                  const isExpanded = expandedCandidate === candidate.id;
                  return (
                    <React.Fragment key={candidate.id}>
                      <TableRow className={isExpanded ? "border-b-0" : ""}>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => setExpandedCandidate(isExpanded ? null : candidate.id)}
                          >
                            {isExpanded ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{candidate.full_name}</p>
                            <p className="text-sm text-muted-foreground">{candidate.region || 'N/A'}</p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{candidate.mentions?.toLocaleString() || 0}</TableCell>
                        <TableCell>
                          {candidate.sentiment !== null ? (
                            <div className="flex items-center gap-2">
                              <Badge variant={
                                candidate.sentiment >= 60 ? 'default' :
                                candidate.sentiment >= 40 ? 'secondary' :
                                'destructive'
                              }>
                                {candidate.sentiment}%
                              </Badge>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-sm">Não analisado</span>
                          )}
                        </TableCell>
                        {/* Coluna de Tendência removida temporariamente - só exibir quando houver comparação real de períodos */}
                        <TableCell className="hidden md:table-cell">
                          {candidate.last_analysis_at ? (
                            <span className="text-sm text-muted-foreground">
                              {new Date(candidate.last_analysis_at).toLocaleDateString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </span>
                          ) : (
                            <Badge variant="outline" className="text-xs">Nunca coletado</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right p-2 sm:p-4 align-top">
                          <div className="grid grid-cols-4 gap-1.5 w-[140px] sm:w-auto sm:flex sm:justify-end sm:gap-2 sm:flex-nowrap [&_button]:h-8 [&_button]:w-8 [&_button]:p-0 sm:[&_button]:h-9 sm:[&_button]:w-9">
                            <TooltipProvider>
                              {/* View Details Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setExpandedCandidate(isExpanded ? null : candidate.id)}
                                  >
                                    <BarChart3 className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Ver dados consolidados</p>
                                </TooltipContent>
                              </Tooltip>

                              {/* YouTube Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-destructive/10 hover:bg-destructive/20 border-destructive/30"
                                    onClick={() => youtubeCollectionMutation.mutate({ 
                                      candidateId: candidate.id, 
                                      candidateName: candidate.full_name 
                                    })}
                                    disabled={youtubeCollectionMutation.isPending}
                                  >
                                    {youtubeCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Youtube className="h-4 w-4 text-destructive" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar dados do YouTube</p>
                                  <p className="text-xs text-muted-foreground">
                                    Busca vídeos e comentários reais
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Twitter/X Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-sky-500/10 hover:bg-sky-500/20 border-sky-500/30"
                                    onClick={() => twitterCollectionMutation.mutate({ 
                                      candidateId: candidate.id, 
                                      candidateName: candidate.full_name 
                                    })}
                                    disabled={twitterCollectionMutation.isPending}
                                  >
                                    {twitterCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Twitter className="h-4 w-4 text-sky-500" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar dados do Twitter/X</p>
                                  <p className="text-xs text-muted-foreground">
                                    Busca tweets e menções públicas
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Reddit Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-orange-500/10 hover:bg-orange-500/20 border-orange-500/30"
                                    onClick={() => redditCollectionMutation.mutate({
                                      candidateId: candidate.id,
                                      candidateName: candidate.full_name
                                    })}
                                    disabled={redditCollectionMutation.isPending}
                                  >
                                    {redditCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <MessageCircle className="h-4 w-4 text-orange-500" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar dados do Reddit</p>
                                  <p className="text-xs text-muted-foreground">
                                    Busca posts e comentários públicos
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Telegram Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-cyan-500/10 hover:bg-cyan-500/20 border-cyan-500/30"
                                    onClick={() => telegramCollectionMutation.mutate({
                                      candidateId: candidate.id,
                                      candidateName: candidate.full_name
                                    })}
                                    disabled={telegramCollectionMutation.isPending}
                                  >
                                    {telegramCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4 text-cyan-500" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar dados do Telegram</p>
                                  <p className="text-xs text-muted-foreground">
                                    Lê canais públicos via RSSHub/RSS-Bridge
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Google News Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-success/10 hover:bg-success/20 border-success/30"
                                    onClick={() => googleNewsCollectionMutation.mutate({
                                      candidateId: candidate.id,
                                      candidateName: candidate.full_name
                                    })}
                                    disabled={googleNewsCollectionMutation.isPending}
                                  >
                                    {googleNewsCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Newspaper className="h-4 w-4 text-success" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar notícias do Google News</p>
                                  <p className="text-xs text-muted-foreground">
                                    RSS oficial, sem API key
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* TikTok Collection Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-foreground/10 hover:bg-foreground/20 border-foreground/30"
                                    onClick={() => tiktokCollectionMutation.mutate({
                                      candidateId: candidate.id,
                                      candidateName: candidate.full_name
                                    })}
                                    disabled={tiktokCollectionMutation.isPending}
                                  >
                                    {tiktokCollectionMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Music2 className="h-4 w-4 text-foreground" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Coletar dados do TikTok</p>
                                  <p className="text-xs text-muted-foreground">
                                    Scraping via Urlebird (visualizador público)
                                  </p>
                                </TooltipContent>
                              </Tooltip>

                              {/* Backfill Replies Button */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="bg-violet-500/10 hover:bg-violet-500/20 border-violet-500/30"
                                    onClick={() => backfillRepliesMutation.mutate({ candidateId: candidate.id })}
                                    disabled={backfillRepliesMutation.isPending}
                                  >
                                    {backfillRepliesMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <MessagesSquare className="h-4 w-4 text-violet-500" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Backfill de comentários (7 dias)</p>
                                  <p className="text-xs text-muted-foreground">
                                    Busca replies em posts já coletados (Reddit, Twitter, Telegram)
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="default"
                                    size="sm"
                                    onClick={() => analyzeCandidateMutation.mutate(candidate.id)}
                                    disabled={analyzeCandidateMutation.isPending}
                                  >
                                    {analyzeCandidateMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Brain className="h-4 w-4" />
                                    )}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>Análise multi-IA (Gemini Flash, Gemini Pro, GPT-5 Mini)</p>
                                  <p className="text-xs text-muted-foreground">
                                    {subscription ? `${subscription.updates_used_this_month}/${subscription.max_updates_per_month} análises usadas` : ''}
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setCandidateToDelete(candidate.id);
                                setDeleteDialogOpen(true);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      
                      {/* Expandable Panel */}
                      {isExpanded && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30 p-6">
                            <CandidateOverviewPanel 
                              candidateId={candidate.id} 
                              candidateName={candidate.full_name}
                            />
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Remoção</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este candidato? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCandidateMutation.isPending}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => candidateToDelete && deleteCandidateMutation.mutate(candidateToDelete)}
              disabled={deleteCandidateMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCandidateMutation.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
