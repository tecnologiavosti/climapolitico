import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Sanitiza texto vindo do banco para garantir JSON válido nas chamadas à IA.
// Remove: caracteres de controle, lone surrogates (que quebram o serializador JSON
// do Cerebras com "unexpected end of hex escape"), e normaliza espaços.
function sanitizeForAI(s: unknown): string {
  if (s == null) return "";
  let str = String(s);
  // Remove HTML/URLs que aparecem em alguns coletores e poluem a análise estatística.
  str = str.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/gi, " ");
  // Remove caracteres de controle (exceto \n, \r, \t)
  str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  // Remove lone high/low surrogates (emojis quebrados)
  str = str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
  str = str.replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
  // Colapsa espaços
  return str.replace(/\s+/g, " ").trim();
}

function extractFrequentTerms(texts: string[]): string[] {
  const stopWords = new Set([
    'para', 'como', 'mais', 'muito', 'pela', 'pelo', 'isso', 'essa', 'esse', 'esta', 'este',
    'entre', 'sobre', 'quando', 'onde', 'tambem', 'também', 'presidente', 'candidato', 'candidata',
    'lula', 'bolsonaro', 'silva', 'brasil', 'brasileiro', 'brasileira', 'politica', 'política',
    'https', 'http', 'href', 'class', 'message', 'text', 'target', 'blank', 'rel', 'nofollow', 'nbsp'
  ]);
  const counts = new Map<string, number>();
  texts.join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9#@]{4,}/g)
    ?.forEach((word) => {
      if (!stopWords.has(word) && !/^\d+$/.test(word)) counts.set(word, (counts.get(word) || 0) + 1);
    });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([word]) => word.replace(/^#/, ''));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { candidateId, startDate, endDate, eventName } = await req.json();
    if (!candidateId || !startDate || !endDate) {
      return new Response(JSON.stringify({ error: 'candidateId, startDate e endDate são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: candidate } = await supabaseService
      .from('candidates')
      .select('id, full_name, party, region, user_id')
      .eq('id', candidateId)
      .maybeSingle();

    if (!candidate) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    if (candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Candidato pertence a outro usuário' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch comments in period with pagination
    let comments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      // Use original_posted_at quando disponível (data real do comentário); fallback para created_at (coleta).
      // Aplicamos OR para captar interações sem original_posted_at também.
      const { data: page, error } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, created_at, original_posted_at')
        .eq('candidate_id', candidateId)
        .or(`and(original_posted_at.gte.${startDate},original_posted_at.lte.${endDate}),and(original_posted_at.is.null,created_at.gte.${startDate},created_at.lte.${endDate})`)
        .order('original_posted_at', { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSize - 1);

      if (error) { console.error(error); break; }
      if (!page || page.length === 0) break;
      comments = [...comments, ...page];
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    if (comments.length === 0) {
      return new Response(JSON.stringify({
        report: null,
        message: 'Nenhum comentário encontrado no período selecionado.',
        stats: { total: 0 }
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const stats = {
      total: comments.length,
      positive: comments.filter(c => c.sentiment_label === 'Positivo').length,
      negative: comments.filter(c => c.sentiment_label === 'Negativo').length,
      neutral: comments.filter(c => c.sentiment_label === 'Neutro').length,
      byNetwork: {} as Record<string, number>,
    };
    comments.forEach(c => { stats.byNetwork[c.social_network] = (stats.byNetwork[c.social_network] || 0) + 1; });

    // Daily volume breakdown
    const dailyVolume: Record<string, { total: number; positive: number; negative: number; neutral: number }> = {};
    comments.forEach(c => {
      const day = c.created_at?.substring(0, 10) || 'unknown';
      if (!dailyVolume[day]) dailyVolume[day] = { total: 0, positive: 0, negative: 0, neutral: 0 };
      dailyVolume[day].total++;
      if (c.sentiment_label === 'Positivo') dailyVolume[day].positive++;
      else if (c.sentiment_label === 'Negativo') dailyVolume[day].negative++;
      else dailyVolume[day].neutral++;
    });

    // Top comments by engagement
    const topComments = [...comments]
      .filter(c => c.comment_text)
      .sort((a, b) => ((b.likes_count || 0) + (b.replies_count || 0)) - ((a.likes_count || 0) + (a.replies_count || 0)))
      .slice(0, 15)
      .map(c => ({
        text: c.comment_text?.substring(0, 300),
        author: c.comment_author,
        network: c.social_network,
        sentiment: c.sentiment_label,
        likes: c.likes_count || 0,
        replies: c.replies_count || 0,
        date: c.created_at,
      }));

    // AI analysis
    const sampleNeg = comments.filter(c => c.sentiment_label === 'Negativo' && c.comment_text).slice(0, 80).map(c => sanitizeForAI(c.comment_text).substring(0, 250)).filter(Boolean);
    const samplePos = comments.filter(c => c.sentiment_label === 'Positivo' && c.comment_text).slice(0, 80).map(c => sanitizeForAI(c.comment_text).substring(0, 250)).filter(Boolean);
    const sampleNeu = comments.filter(c => c.sentiment_label === 'Neutro' && c.comment_text).slice(0, 40).map(c => sanitizeForAI(c.comment_text).substring(0, 200)).filter(Boolean);

    const eventLabel = eventName || `período de ${startDate.substring(0, 10)} a ${endDate.substring(0, 10)}`;

    const buildDeterministicReport = (reason: 'ai_unavailable' | 'no_ai_key') => {
      const negativePct = stats.negative / stats.total;
      const positivePct = stats.positive / stats.total;
      const neutralPct = Math.max(0, 1 - negativePct - positivePct);
      const overall_assessment = negativePct >= 0.45
        ? 'muito_negativa'
        : negativePct >= 0.32
        ? 'negativa'
        : positivePct >= 0.7
        ? 'muito_positiva'
        : positivePct >= 0.55
        ? 'positiva'
        : 'mista';
      const topNetworks = Object.entries(stats.byNetwork).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const topics = extractFrequentTerms([...sampleNeg, ...samplePos, ...sampleNeu]);

      return {
        overall_assessment,
        executive_summary: `Foram analisados ${stats.total} comentários sobre ${eventLabel}. A repercussão teve ${stats.positive} comentários positivos, ${stats.negative} negativos e ${stats.neutral} neutros, com maior volume em ${topNetworks.map(([network]) => network).join(', ') || 'redes sociais monitoradas'}. Como a IA principal ficou indisponível no momento, este relatório foi gerado por leitura estatística direta dos dados coletados.`,
        key_reactions: [
          { reaction: `Apoio identificado em ${Math.round(positivePct * 100)}% das interações classificadas.`, type: 'positiva', intensity: positivePct >= 0.5 ? 'alta' : 'media' },
          { reaction: `Rejeição ou crítica apareceu em ${Math.round(negativePct * 100)}% das interações.`, type: 'negativa', intensity: negativePct >= 0.35 ? 'alta' : 'media' },
          { reaction: `Participação neutra/ambígua estimada em ${Math.round(neutralPct * 100)}%, indicando espaço para disputa de narrativa.`, type: 'neutra', intensity: neutralPct >= 0.3 ? 'media' : 'baixa' },
        ],
        main_topics: topics.length ? topics : ['repercussão pública', 'engajamento', 'sentimento', 'narrativa política'],
        impact_analysis: `O impacto calculado pelos dados é ${overall_assessment.replace('_', ' ')}. A leitura deve priorizar as redes com maior volume (${topNetworks.map(([network, count]) => `${network}: ${count}`).join('; ')}) e os comentários de maior engajamento para entender quais mensagens estão impulsionando a percepção pública.`,
        immediate_actions: [
          negativePct > positivePct ? 'Responder rapidamente aos pontos críticos mais recorrentes com mensagens simples e verificáveis.' : 'Amplificar os temas positivos com cortes, cards e depoimentos nas redes de maior volume.',
          'Usar os comentários mais relevantes como insumo para ajustar a comunicação nas próximas 24 horas.',
          'Monitorar se o sentimento muda após novas publicações ou respostas oficiais.'
        ],
        lessons_learned: [
          'Eventos com alto volume exigem acompanhamento diário por rede social, não apenas leitura agregada.',
          'Picos de engajamento ajudam a identificar quais temas devem virar prioridade de comunicação.',
          reason === 'ai_unavailable' ? 'Quando a IA estiver disponível novamente, gere nova versão para obter análise semântica mais profunda.' : 'Configure a IA para obter análise semântica mais profunda.'
        ]
      };
    };

    const prompt = `Você é um analista político estratégico brasileiro. Analise a repercussão do evento/período "${eventLabel}" para o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}.

ESTATÍSTICAS DO PERÍODO:
- Total de comentários: ${stats.total}
- Positivos: ${stats.positive} (${((stats.positive / stats.total) * 100).toFixed(1)}%)
- Negativos: ${stats.negative} (${((stats.negative / stats.total) * 100).toFixed(1)}%)
- Neutros: ${stats.neutral} (${((stats.neutral / stats.total) * 100).toFixed(1)}%)

VOLUME DIÁRIO:
${Object.entries(dailyVolume).sort().map(([d, v]) => `${d}: ${v.total} (pos:${v.positive} neg:${v.negative} neu:${v.neutral})`).join('\n')}

COMENTÁRIOS NEGATIVOS (${sampleNeg.length}):
${sampleNeg.map((c, i) => `${i + 1}. ${c}`).join('\n')}

COMENTÁRIOS POSITIVOS (${samplePos.length}):
${samplePos.map((c, i) => `${i + 1}. ${c}`).join('\n')}

COMENTÁRIOS NEUTROS (${sampleNeu.length}):
${sampleNeu.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Gere um relatório completo de repercussão deste evento/período.`;

    const systemMsg = 'Você é um analista político estratégico brasileiro. Gere relatórios de repercussão de eventos baseados em dados reais. Responda em português do Brasil.';
    const jsonInstruction = `\n\nResponda APENAS com um JSON válido (sem markdown, sem comentários) no seguinte formato exato:\n{\n  "overall_assessment": "muito_positiva|positiva|mista|negativa|muito_negativa",\n  "executive_summary": "resumo executivo em 3-5 frases",\n  "key_reactions": [{"reaction": "texto", "type": "positiva|negativa|neutra", "intensity": "alta|media|baixa"}],\n  "main_topics": ["tema1","tema2"],\n  "impact_analysis": "análise de impacto",\n  "immediate_actions": ["ação1","ação2"],\n  "lessons_learned": ["lição1","lição2"]\n}`;

    let report: any = null;
    let lastError: { status: number; text: string } | null = null;

    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg,
        userPrompt: prompt + jsonInstruction,
        jsonMode: true,
        maxTokens: 3000,
        temperature: 0.3,
        tag: 'event-repercussion',
      });
      const content = aiRes.content || '';
      try {
        report = JSON.parse(content);
      } catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) report = JSON.parse(m[0]);
      }
      if (report) console.log(`[event-repercussion] ✅ ${aiRes.provider}:${aiRes.model} OK`);
    } catch (e) {
      const msg = (e as Error).message || '';
      console.error('[event-repercussion] all providers failed:', msg);
      const status = /créditos/i.test(msg) ? 402 : /limite/i.test(msg) ? 429 : 503;
      lastError = { status, text: msg };
    }

    if (!report) {
      const code = lastError?.status === 429
        ? 'AI_RATE_LIMITED'
        : lastError?.status === 402
        ? 'AI_CREDITS_EXHAUSTED'
        : 'AI_UNAVAILABLE';
      const msg = code === 'AI_RATE_LIMITED'
        ? 'Limite de requisições da IA excedido. Tente novamente em alguns minutos.'
        : code === 'AI_CREDITS_EXHAUSTED'
        ? 'A IA de fallback ficou indisponível no momento.'
        : 'Não foi possível gerar o relatório com IA no momento.';
      const deterministicReport = buildDeterministicReport('ai_unavailable');
      // Return a usable report even when external AI providers fail, so the tab never appears empty.
      return new Response(JSON.stringify({
        report: deterministicReport,
        fallback: true,
        error: code,
        message: `${msg} Exibindo relatório estatístico com os dados reais coletados.`,
        stats,
        dailyVolume,
        topComments,
        candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party },
        period: { startDate, endDate, eventName: eventName || null },
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      report,
      stats,
      dailyVolume,
      topComments,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party },
      period: { startDate, endDate, eventName: eventName || null }
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
