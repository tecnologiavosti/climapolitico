import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const { data: candidate } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region')
      .eq('id', candidateId)
      .eq('user_id', user.id)
      .single();

    if (!candidate) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Fetch comments in period with pagination
    let comments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_label, sentiment_score, likes_count, replies_count, shares_count, social_network, created_at')
        .eq('candidate_id', candidateId)
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false })
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
    const sampleNeg = comments.filter(c => c.sentiment_label === 'Negativo' && c.comment_text).slice(0, 80).map(c => c.comment_text.substring(0, 250));
    const samplePos = comments.filter(c => c.sentiment_label === 'Positivo' && c.comment_text).slice(0, 80).map(c => c.comment_text.substring(0, 250));
    const sampleNeu = comments.filter(c => c.sentiment_label === 'Neutro' && c.comment_text).slice(0, 40).map(c => c.comment_text.substring(0, 200));

    const eventLabel = eventName || `período de ${startDate.substring(0, 10)} a ${endDate.substring(0, 10)}`;

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

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'Chave de API não configurada' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: 'Você é um analista político estratégico brasileiro. Gere relatórios de repercussão de eventos baseados em dados reais. Responda em português do Brasil.' },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_event_report',
            description: 'Gerar relatório estruturado de repercussão de evento',
            parameters: {
              type: 'object',
              properties: {
                overall_assessment: { type: 'string', enum: ['muito_positiva', 'positiva', 'mista', 'negativa', 'muito_negativa'], description: 'Avaliação geral da repercussão' },
                executive_summary: { type: 'string', description: 'Resumo executivo em 3-5 frases sobre a repercussão do evento' },
                key_reactions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      reaction: { type: 'string', description: 'Reação identificada' },
                      type: { type: 'string', enum: ['positiva', 'negativa', 'neutra'] },
                      intensity: { type: 'string', enum: ['alta', 'media', 'baixa'] }
                    },
                    required: ['reaction', 'type', 'intensity']
                  },
                  description: '4-8 principais reações do público'
                },
                main_topics: { type: 'array', items: { type: 'string' }, description: '3-6 temas mais discutidos' },
                impact_analysis: { type: 'string', description: 'Análise do impacto potencial na imagem do candidato' },
                immediate_actions: { type: 'array', items: { type: 'string' }, description: '3-5 ações recomendadas de resposta imediata' },
                lessons_learned: { type: 'array', items: { type: 'string' }, description: '2-4 lições para eventos futuros' }
              },
              required: ['overall_assessment', 'executive_summary', 'key_reactions', 'main_topics', 'impact_analysis', 'immediate_actions', 'lessons_learned']
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_event_report' } }
      })
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error('AI error:', aiResponse.status, errText);
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: 'Limite de requisições excedido.' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: 'Créditos insuficientes.' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: 'Erro ao gerar relatório' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const result = await aiResponse.json();
    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return new Response(JSON.stringify({ error: 'Resposta inesperada da IA' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const report = JSON.parse(toolCall.function.arguments);

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
