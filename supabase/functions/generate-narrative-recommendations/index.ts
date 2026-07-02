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

async function callAI(systemMsg: string, userPrompt: string, maxTokens = 5000) {
  const r = await callAICerebrasFirst({
    systemMsg, userPrompt, jsonMode: true, maxTokens, temperature: 0.5, tag: 'narrative-ai',
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

    let { data: candidate } = await supabaseClient
      .from('candidates')
      .select('id, full_name, party, region')
      .eq('id', candidateId)
      .eq('user_id', user.id)
      .maybeSingle();

    // Fallback: allow public catalog candidates too
    if (!candidate) {
      const { data: pub } = await supabaseClient
        .from('public_candidates_catalog')
        .select('id, full_name, party, region')
        .eq('id', candidateId)
        .maybeSingle();
      if (pub) candidate = pub;
    }

    if (!candidate) {
      return json({
        error: 'Candidato não encontrado',
        fallback: true,
        message: 'Candidato não encontrado ou removido. Selecione outro candidato.',
        recommendations: null,
      }, 200);
    }

    const baseCtx = `Candidato: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` — Região: ${candidate.region}` : ''}.
Período: ${customStart && customEnd ? `${customStart} → ${customEnd}` : `últimos ${daysBack} dias`}.

Você é um cientista político e estrategista de campanha brasileiro sênior. Produza análise no estilo Bloomberg/War Room: técnica, política, institucional. PROIBIDO usar termos: arquétipo, guerreiro, outsider, protetor, energia, vibe, storytelling emocional, branding pessoal, tom emocional, DNA narrativo. Use linguagem de consultor eleitoral profissional brasileiro.`;

    const prompt = `${baseCtx}

Gere uma análise completa NO FORMATO JSON exato abaixo, em português do Brasil, específica ao candidato. Scores 0-100. Não invente números de mídia.

{
  "central_thesis": {
    "headline": "tese central de campanha em 1-2 frases políticas",
    "confidence": 0-100,
    "rationale": "por que essa tese converte voto, em linguagem de estrategista"
  },
  "political_diagnosis": {
    "dominant_positioning": "Conservador institucional|Direita liberal|Centro pragmático|Progressista reformista|Populista de oposição|Tecnocrata de gestão|Municipalista|Desenvolvimentista",
    "public_perception": "como o eleitorado percebe hoje",
    "ideological_position": "posicionamento ideológico com nuance",
    "electoral_strength": 0-100,
    "base_consolidation": 0-100,
    "critical_rejection": 0-100
  },
  "vote_drivers": [
    { "topic": "Segurança pública|Economia|Anticorrupção|Costumes|Desenvolvimento regional|Saúde|Educação|Agro|Infraestrutura|Liberdade econômica|...", "score": 0-100, "explanation": "..." }
  ],
  "positioning_matrix": {
    "autoridade_institucional": 0-100,
    "mobilizacao": 0-100,
    "penetracao_popular": 0-100,
    "confianca_economica": 0-100,
    "confronto": 0-100,
    "elasticidade_eleitoral": 0-100
  },
  "electoral_vulnerabilities": {
    "high":   [ { "title": "...", "explanation": "..." } ],
    "medium": [ { "title": "...", "explanation": "..." } ],
    "low":    [ { "title": "...", "explanation": "..." } ]
  },
  "discourse_pillars": [
    { "pillar": "...", "message": "...", "target": "..." }
  ],
  "opposition_attacks": [
    { "attack": "...", "risk": "...", "damage_potential": 0-100, "works_with": ["jovens urbanos","classe média progressista","..."] }
  ],
  "strategic_responses": [
    { "attack": "...", "response": "resposta de campanha pronta", "channel": "Debate|TV|Instagram|Entrevista|Rádio" }
  ],
  "priority_audiences": {
    "hard_core":      "descrição do núcleo duro",
    "persuadable":    "descrição dos persuasíveis",
    "hard_convert":   "descrição da conversão difícil",
    "locked_rejection": "descrição da rejeição consolidada"
  },
  "conversion_themes": [
    { "theme": "...", "score": 0-100, "segments": ["..."], "recommended_narrative": "..." }
  ],
  "communication_risks": [
    { "risk": "...", "mitigation": "..." }
  ],
  "channel_plan": {
    "instagram": { "objective": "...", "message_type": "...", "format": "...", "frequency": "..." },
    "tiktok":    { "objective": "...", "message_type": "...", "format": "...", "frequency": "..." },
    "debates":   { "objective": "...", "message_type": "...", "format": "...", "frequency": "..." },
    "tv":        { "objective": "...", "message_type": "...", "format": "...", "frequency": "..." },
    "interior":  { "objective": "...", "message_type": "...", "format": "...", "frequency": "..." }
  },
  "executive_briefing": {
    "scenario": "Expansão|Consolidação|Risco",
    "main_opportunity": "...",
    "main_threat": "...",
    "immediate_action": "...",
    "growth_probability": 0-100,
    "retraction_probability": 0-100
  },
  "confidence": 0-100
}

Mínimos: 6 vote_drivers, 5 discourse_pillars, 4 opposition_attacks, 4 strategic_responses (alinhados aos ataques), 5 conversion_themes, 3 communication_risks, 2 itens em cada nível de electoral_vulnerabilities.`;

    const { parsed, provider } = await callAI(
      'Você é estrategista político brasileiro sênior (war room). Responda SEMPRE em JSON válido seguindo o schema solicitado, em português do Brasil, linguagem técnica e institucional.',
      prompt,
      6000,
    );

    if (!parsed || !parsed.central_thesis) {
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
