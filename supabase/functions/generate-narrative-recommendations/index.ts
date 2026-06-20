import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

async function callAI(systemMsg: string, userPrompt: string, maxTokens = 3500) {
  const r = await callAICerebrasFirst({
    systemMsg, userPrompt, jsonMode: true, maxTokens, temperature: 0.55, tag: 'narrative-ai',
  });
  return { parsed: safeParse(r.content || ''), provider: `${r.provider}:${r.model}` };
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
    if (userError || !user) return json({ error: 'Não autorizado' }, 401);

    const body = await req.json().catch(() => ({}));
    const { candidateId, daysBack = 7, startDate: customStart, endDate: customEnd } = body;

    if (!candidateId) return json({ error: 'candidateId é obrigatório' }, 400);

    const { data: candidate, error: candError } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region')
      .eq('id', candidateId)
      .eq('user_id', user.id)
      .single();

    if (candError || !candidate) return json({ error: 'Candidato não encontrado' }, 404);

    const baseCtx = `Candidato: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` — Região: ${candidate.region}` : ''}.
Período de análise: ${customStart && customEnd ? `${customStart} → ${customEnd}` : `últimos ${daysBack} dias`}.

Você é o consultor estratégico mais avançado do Brasil, operando como uma war room de campanha presidencial. Analise EXCLUSIVAMENTE a partir do seu conhecimento sobre arquétipos políticos, percepção pública estimada, posicionamento ideológico, força emocional, vulnerabilidades e ataques previsíveis. NÃO use contagem de menções ou comentários.`;

    const prompt = `${baseCtx}

Gere uma análise estratégica COMPLETA no formato JSON exato abaixo.
Regras: cada campo deve ser específico ao candidato, não genérico. Scores são 0-100. Não invente estatísticas numéricas de mídia.

{
  "central_narrative": "narrativa central recomendada em 1-2 frases",
  "archetype": "arquétipo político (ex: O Reformador, O Pai da Família, O Guerreiro, O Sábio, O Outsider)",
  "archetype_rationale": "por quê",
  "public_perception": "como o público estimadamente percebe o candidato hoje",
  "ideological_position": "posicionamento ideológico (centro, direita-liberal, etc) e sua nuance",
  "emotional_force": 0-100,
  "narrative_dna": {
    "emocao": 0-100, "autoridade": 0-100, "carisma": 0-100,
    "confianca": 0-100, "combatividade": 0-100, "proximidade": 0-100
  },
  "narrative_gaps": [
    { "topic": "...", "opportunity": "...", "why": "..." }
  ],
  "high_conversion_narratives": [
    { "narrative": "...", "score": 0-100, "target_audience": "...", "rationale": "..." }
  ],
  "harmful_narratives": [
    { "narrative": "...", "risk": "...", "mitigation": "..." }
  ],
  "discourse_matrix": {
    "conservador": { "electoral_impact": 0-100, "reputational_risk": 0-100, "conversion_rate": 0-100, "summary": "..." },
    "moderado":    { "electoral_impact": 0-100, "reputational_risk": 0-100, "conversion_rate": 0-100, "summary": "..." },
    "economico":   { "electoral_impact": 0-100, "reputational_risk": 0-100, "conversion_rate": 0-100, "summary": "..." },
    "polarizador": { "electoral_impact": 0-100, "reputational_risk": 0-100, "conversion_rate": 0-100, "summary": "..." }
  },
  "narrative_elasticity": {
    "score": 0-100,
    "label": "Baixa|Média|Alta capacidade de reposicionamento",
    "explanation": "explicação estratégica sobre a capacidade do candidato de mudar discurso sem perder base"
  },
  "emotional_triggers": [
    { "emotion": "segurança|autoridade|proteção|indignação|esperança|...", "score": 0-100, "why": "..." }
  ],
  "attack_surface": {
    "high":   [ { "vector": "...", "why": "..." } ],
    "medium": [ { "vector": "...", "why": "..." } ],
    "low":    [ { "vector": "...", "why": "..." } ]
  },
  "counter_narratives": [
    { "attack": "ataque previsível do adversário", "response": "resposta estratégica recomendada", "channel": "TV|Debate|Redes|Comício" }
  ],
  "channel_plan": {
    "instagram": { "strategy": "...", "tone": "...", "content_examples": ["...","..."] },
    "tiktok":    { "strategy": "...", "tone": "...", "content_examples": ["...","..."] },
    "debates":   { "strategy": "...", "tone": "...", "content_examples": ["...","..."] },
    "tv":        { "strategy": "...", "tone": "...", "content_examples": ["...","..."] },
    "interior":  { "strategy": "...", "tone": "...", "content_examples": ["...","..."] }
  },
  "confidence": 0-100
}

Mínimos: 3 narrative_gaps, 4 high_conversion_narratives, 3 harmful_narratives, 5 emotional_triggers, 4 counter_narratives, 2 itens em cada nível de attack_surface.`;

    const { parsed, provider } = await callAI(
      'Você é consultor estratégico de campanha presidencial brasileira (war room). Responda SEMPRE em JSON válido seguindo o schema solicitado, em português do Brasil.',
      prompt,
      4500,
    );

    if (!parsed || !parsed.central_narrative) {
      return json({
        recommendations: null,
        fallback: true,
        message: 'Serviço de IA temporariamente indisponível. Tente novamente.',
        candidate,
      });
    }

    return json({
      recommendations: parsed,
      candidate,
      period: customStart && customEnd
        ? { startDate: customStart, endDate: customEnd }
        : { daysBack, startDate: new Date(Date.now() - daysBack * 86400000).toISOString(), endDate: new Date().toISOString() },
      ai_provider: provider,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('narrative-ai error:', error);
    return json({
      recommendations: null,
      fallback: true,
      message: error instanceof Error ? error.message : 'Erro desconhecido',
    });
  }
});
