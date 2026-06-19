import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type Confidence = 'baixa' | 'moderada' | 'boa' | 'alta';
function getConfidence(n: number): Confidence {
  if (n < 10) return 'baixa';
  if (n < 30) return 'moderada';
  if (n < 80) return 'boa';
  return 'alta';
}

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
    const confidence = getConfidence(evidenceCount);
    const lowSample = evidenceCount < 30;
    const noEvidence = evidenceCount === 0;

    const sampleForAI = negativeComments
      .filter(c => c.comment_text)
      .slice(0, 250)
      .map(c => c.comment_text.substring(0, 280));

    const systemMsg = `Você é um estrategista político sênior brasileiro, especializado em reputação eleitoral, war room e mitigação de rejeição. Você SEMPRE gera uma análise reputacional plausível. Quando não houver comentários coletados, baseie a análise no perfil público do candidato (nome, partido, região), no contexto político brasileiro contemporâneo e em padrões reputacionais típicos do espectro ao qual ele pertence — SEM inventar escândalos, falas, citações ou estatísticas específicas. Toda inferência deve ser interpretativa e clara como tal. Nunca recuse a análise por baixo volume. Responda em português do Brasil.`;

    const evidenceBlock = noEvidence
      ? `EVIDÊNCIAS REAIS: nenhuma menção negativa foi coletada nesta janela.
Gere uma análise reputacional baseada APENAS em: perfil partidário, região, espectro ideológico provável, posicionamento histórico público amplamente conhecido e padrões de rejeição típicos desse perfil no Brasil. NÃO invente escândalos ou citações específicas. Em "comment_clusters" e "rejection_language" use exemplos representativos plausíveis marcados como inferência (ex.: "(inferência)").`
      : `EVIDÊNCIAS REAIS (${sampleForAI.length} comentários negativos${lowSample ? ' — amostragem pequena, extraia o máximo possível mesmo assim' : ''}):
${sampleForAI.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;

    const userPrompt = `CANDIDATO: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` — ${candidate.region}` : ''}
JANELA: últimos ${daysBack} dias
${evidenceBlock}

Sua tarefa:
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

Regras: máximo 8 vetores, máximo 5 clusters. SEMPRE retorne o JSON completo, mesmo sem evidências.`;

    function safeParse(raw: string | null | undefined): any | null {
      if (!raw) return null;
      let s = raw.trim();
      // strip code fences
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try { return JSON.parse(s); } catch (_) {}
      // try to extract the largest JSON object
      const first = s.indexOf('{');
      const last = s.lastIndexOf('}');
      if (first !== -1 && last > first) {
        try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
      }
      return null;
    }

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
      analysis = safeParse(result.content);
      if (analysis) aiProvider = `${result.provider}:${result.model}`;
    } catch (e) {
      console.warn('[REJECTION] Cerebras falhou:', (e as Error).message);
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const callLovable = async (useJsonMode: boolean) => {
      const body: any = {
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: systemMsg },
          { role: 'user', content: useJsonMode ? userPrompt : userPrompt + '\n\nResponda APENAS com o objeto JSON, sem texto antes/depois e sem cercas de código.' },
        ],
      };
      if (useJsonMode) body.response_format = { type: 'json_object' };
      const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        console.warn(`[REJECTION] Lovable AI (json=${useJsonMode}) HTTP ${r.status}:`, (await r.text()).slice(0, 300));
        return null;
      }
      const j = await r.json();
      return safeParse(j.choices?.[0]?.message?.content);
    };

    if (!analysis && LOVABLE_API_KEY) {
      try {
        analysis = await callLovable(true);
        if (analysis) aiProvider = 'lovable:gemini-3-flash';
      } catch (e) { console.error('[REJECTION] Lovable AI exception:', e); }
    }
    if (!analysis && LOVABLE_API_KEY) {
      try {
        analysis = await callLovable(false);
        if (analysis) aiProvider = 'lovable:gemini-3-flash:text';
      } catch (e) { console.error('[REJECTION] Lovable AI text exception:', e); }
    }

    if (!analysis) {
      return new Response(JSON.stringify({
        analysis: null,
        fallback: true,
        evidenceCount,
        confidence,
        message: 'Serviço de IA temporariamente sobrecarregado. Tente novamente em instantes.',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }


    return new Response(JSON.stringify({
      analysis,
      evidenceCount,
      confidence,

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
