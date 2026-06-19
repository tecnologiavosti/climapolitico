import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const MIN_EVIDENCE = 50;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { candidateId, daysBack = 7 } = await req.json();
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: candidate, error: candError } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region')
      .eq('id', candidateId)
      .eq('user_id', user.id)
      .single();

    if (candError || !candidate) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    let negativeComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabaseClient
        .from('social_interactions')
        .select('comment_text, comment_author, sentiment_score, likes_count, replies_count, social_network, created_at')
        .eq('candidate_id', candidateId)
        .eq('sentiment_label', 'Negativo')
        .gte('created_at', startDate.toISOString())
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (pageError) break;
      if (!page || page.length === 0) break;
      negativeComments = [...negativeComments, ...page];
      if (page.length < pageSize) break;
      offset += pageSize;
    }

    const evidenceCount = negativeComments.length;

    if (evidenceCount < MIN_EVIDENCE) {
      return new Response(JSON.stringify({
        analysis: null,
        insufficient: true,
        evidenceCount,
        minRequired: MIN_EVIDENCE,
        message: 'Dados insuficientes para análise de rejeição confiável.',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sampleForAI = negativeComments
      .filter(c => c.comment_text)
      .slice(0, 250)
      .map(c => c.comment_text.substring(0, 280));

    const systemMsg = `Você é um estrategista político sênior brasileiro, especializado em reputação eleitoral, war room e mitigação de rejeição. Analise SOMENTE as evidências reais fornecidas. Não use conhecimento histórico do candidato. Não invente acusações, críticas ou narrativas. Responda em português do Brasil.`;

    const userPrompt = `CANDIDATO: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}
JANELA: últimos ${daysBack} dias
EVIDÊNCIAS REAIS (${sampleForAI.length} comentários negativos):
${sampleForAI.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Sua tarefa, com base SOMENTE nessas evidências:
- Por que ele é rejeitado?
- Por quem?
- Com qual intensidade?
- Quais ataques mais ferem sua imagem?
- Como mitigar?

Responda EXCLUSIVAMENTE em JSON válido no formato:
{
  "rejection_level": "baixa|moderada|alta|critica|explosiva",
  "diagnosis": "3 a 5 parágrafos curtos explicando origem, intensidade e perfil dos críticos, separados por \\n\\n",
  "rejection_vectors": [
    {"name":"...","weight":"baixo|medio|alto|critico","type":"moral|politico|ideologico|emocional|economico","explanation":"..."}
  ],
  "who_rejects": [{"profile":"...","reason":"..."}],
  "destructive_narratives": [{"narrative":"...","danger":"medio|alto|critico","why_it_works":"..."}],
  "rejection_language": {"raiva":["..."],"deboche":["..."],"medo":["..."]},
  "comment_clusters": [{"theme":"...","representative_quote":"...","frequency_label":"..."}],
  "vulnerability_points": [{"group":"Mulheres|Jovens|Centro político|Nordeste|Eleitor moderado|Evangélicos|Agro|Classe média|...","explanation":"..."}],
  "mitigation": {"comunicacao":["..."],"posicionamento":["..."],"crise":["..."],"narrativa":["..."]}
}

Regras: máximo 8 vetores, máximo 5 clusters, palavras de linguagem devem ser extraídas das evidências (não inventadas).`;

    let analysis: any = null;
    let aiProvider = 'cerebras';

    try {
      const result = await callAICerebrasFirst({
        systemMsg,
        userPrompt,
        jsonMode: true,
        maxTokens: 3500,
        temperature: 0.4,
        tag: 'rejection-mapa',
      });
      analysis = JSON.parse(result.content || '{}');
      aiProvider = `${result.provider}:${result.model}`;
    } catch (e) {
      console.warn('[REJECTION] Cerebras falhou:', (e as Error).message);
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!analysis && LOVABLE_API_KEY) {
      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: userPrompt }
            ],
            response_format: { type: 'json_object' }
          })
        });
        if (aiResponse.ok) {
          const result = await aiResponse.json();
          const content = result.choices?.[0]?.message?.content;
          if (content) {
            analysis = JSON.parse(content);
            aiProvider = 'lovable:gemini-3-flash';
          }
        }
      } catch (e) {
        console.error('Lovable AI exception:', e);
      }
    }

    if (!analysis) {
      return new Response(JSON.stringify({ error: 'Serviço de IA temporariamente indisponível. Tente novamente em instantes.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({
      analysis,
      evidenceCount,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      period: { daysBack, startDate: startDate.toISOString(), endDate: new Date().toISOString() },
      ai_provider: aiProvider
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error analyzing rejection:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
