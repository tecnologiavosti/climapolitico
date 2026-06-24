import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function clamp(n: any): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function levelFromScore(score: number): 'baixa' | 'moderada' | 'alta' | 'critica' | 'extrema' {
  if (score <= 25) return 'baixa';
  if (score <= 50) return 'moderada';
  if (score <= 70) return 'alta';
  if (score <= 85) return 'critica';
  return 'extrema';
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

    const body = await req.json();
    const { candidateId, period, customStart, customEnd } = body || {};
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Temporal weighting: recent (curto prazo) vs historical (estrutural)
    type PeriodKey = '7d' | '30d' | '90d' | '1y' | 'custom';
    const periodKey: PeriodKey = (['7d','30d','90d','1y','custom'].includes(period) ? period : '30d') as PeriodKey;
    const PERIOD_LABEL: Record<PeriodKey, string> = {
      '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias',
      '1y': 'Último ano', 'custom': 'Intervalo personalizado',
    };
    let recentWeight = 0.5;
    let historicalWeight = 0.5;
    let rangeDays = 30;
    if (periodKey === '7d') { recentWeight = 0.4; historicalWeight = 0.6; rangeDays = 7; }
    else if (periodKey === '30d') { recentWeight = 0.5; historicalWeight = 0.5; rangeDays = 30; }
    else if (periodKey === '90d') { recentWeight = 0.3; historicalWeight = 0.7; rangeDays = 90; }
    else if (periodKey === '1y') { recentWeight = 0.1; historicalWeight = 0.9; rangeDays = 365; }
    else if (periodKey === 'custom' && customStart && customEnd) {
      const ms = new Date(customEnd).getTime() - new Date(customStart).getTime();
      rangeDays = Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
      const temporalFactor = Math.min(1, rangeDays / 365);
      // longer range -> more weight on historical
      historicalWeight = Math.min(0.9, 0.4 + temporalFactor * 0.5);
      recentWeight = 1 - historicalWeight;
    }
    const periodLabel = periodKey === 'custom' && customStart && customEnd
      ? `Personalizado (${rangeDays} dias)`
      : PERIOD_LABEL[periodKey];

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

    const systemMsg = `Você é um estrategista político sênior brasileiro especializado em inteligência reputacional preditiva e war room eleitoral. Sua análise é 100% inferencial — você NÃO usa comentários reais, menções, posts ou evidências coletadas. Você infere a rejeição estritamente a partir do perfil político do candidato e do CONTEXTO TEMPORAL solicitado (recorte do período). Nunca cite "comentários", "evidências", "menções" ou "posts coletados". Toda frase representativa que você gerar é SIMULADA por IA com base em padrões narrativos brasileiros — nunca apresentada como real. Responda sempre em português do Brasil.`;

    const userPrompt = `CANDIDATO ALVO:
- Nome: ${candidate.full_name}
- Partido: ${candidate.party || 'não informado'}
- Região/UF: ${candidate.region || 'não informada'}
- Cargo/posição e ideologia: inferir a partir do partido, região e perfil público brasileiro contemporâneo.

CONTEXTO TEMPORAL DA ANÁLISE:
- Período selecionado: ${periodLabel} (${rangeDays} dias).
- Peso para narrativas RECENTES (curto prazo, momento atual, viralizações, falas polêmicas, escândalos recentes): ${Math.round(recentWeight * 100)}%.
- Peso para narrativas HISTÓRICAS / ESTRUTURAIS (desgaste acumulado, reputação consolidada, rejeição estrutural de longo prazo): ${Math.round(historicalWeight * 100)}%.
- Recalibre TODOS os componentes e o diagnóstico aplicando essa ponderação: períodos curtos sensibilizam mais a 'exposicao_negativa' e 'fragilidade_narrativa' atuais; períodos longos sensibilizam mais 'desgaste' e 'antagonismo_ideologico' estrutural. Mudança de percepção, evolução da polarização, ataques recentes vs históricos e tendência reputacional devem refletir o intervalo.

TAREFA — INTELIGÊNCIA PREDITIVA DE REJEIÇÃO (sem usar dados coletados):

Calcule 5 VETORES NEGATIVOS (0–100 cada), ponderados pelo contexto temporal acima:
1. polarizacao — quanto divide opiniões.
2. desgaste — tempo de exposição pública e histórico.
3. antagonismo_ideologico — rejeição em grupos opostos.
4. fragilidade_narrativa — facilidade de ataque (corrupção, velha política, elitismo, radicalismo, inexperiência).
5. exposicao_negativa — probabilidade de narrativas negativas ganharem força no período.

E também 3 VETORES DE PROTEÇÃO / ESCUDO REPUTACIONAL (0–100 cada), que mitigam a rejeição:
6. aprovacao — nível inferido de aprovação pública/popular ativa.
7. base_fiel — solidez e tamanho de base eleitoral leal e mobilizada.
8. autoridade_institucional — capital político institucional, peso de cargo, influência sobre agenda e narrativa nacional.

Importante: candidatos altamente competitivos (ex.: presidentes em exercício, líderes nacionais) devem ter vetores de proteção altos mesmo quando o desgaste e polarização também forem altos. NÃO infle artificialmente a rejeição de quem possui ampla base e capital institucional.

Responda EXCLUSIVAMENTE em JSON válido no formato:
{
  "components": {
    "polarizacao": 0-100,
    "desgaste": 0-100,
    "antagonismo_ideologico": 0-100,
    "fragilidade_narrativa": 0-100,
    "exposicao_negativa": 0-100,
    "aprovacao": 0-100,
    "base_fiel": 0-100,
    "autoridade_institucional": 0-100
  },
  "diagnosis": "2 a 4 parágrafos curtos, separados por \\n\\n, explicando por que esse candidato gera rejeição — SEM citar evidências, comentários ou menções. Inferência estratégica pura.",
  "who_rejects": [
    {"profile": "Ex.: Jovens urbanos progressistas / Evangélicos conservadores / Setor empresarial / Eleitor anti-establishment", "reason": "Por que esse grupo rejeita."}
  ],
  "attack_narratives": [
    {"narrative": "Frase curta de ataque (ex.: 'Representa a velha política')", "why_it_works": "Por que esse ataque tende a ganhar tração contra esse perfil."}
  ],
  "emotional_language": {
    "raiva": ["clusters semânticos curtos: corrupção, abandono, privilégio..."],
    "deboche": ["ultrapassado, desconectado, irrelevante..."],
    "medo": ["retrocesso, instabilidade, radicalização..."]
  },
  "simulated_narratives": [
    "Frase sintética 1 (simulada por IA, jamais real)",
    "Frase sintética 2",
    "Frase sintética 3"
  ],
  "vulnerability_points": [
    {"group": "Ex.: Jovens 18–29 / Capitais / Sudeste / Eleitor moderado", "explanation": "Por que ele perde votos aqui."}
  ],
  "mitigation": {
    "comunicacao": ["recomendação 1", "recomendação 2"],
    "posicionamento": ["..."],
    "crise": ["..."],
    "narrativa": ["..."]
  }
}

Regras: 4 a 6 perfis em who_rejects, 3 a 6 narrativas em attack_narratives, 3 a 6 frases em simulated_narratives, 3 a 5 em cada cluster de emotional_language, 3 a 5 vulnerability_points, 2 a 4 itens em cada frente de mitigation. NUNCA mencione comentários reais, evidências coletadas ou contagem de menções.`;

    function safeParse(raw: string | null | undefined): any | null {
      if (!raw) return null;
      let s = raw.trim();
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
      try { return JSON.parse(s); } catch (_) {}
      const first = s.indexOf('{');
      const last = s.lastIndexOf('}');
      if (first !== -1 && last > first) {
        try { return JSON.parse(s.slice(first, last + 1)); } catch (_) {}
      }
      return null;
    }

    let analysis: any = null;
    let aiProvider = 'none';

    try {
      const result = await callAICerebrasFirst({
        systemMsg, userPrompt, jsonMode: true,
        maxTokens: 3500, temperature: 0.5, tag: 'rejection-ia',
      });
      const parsed = safeParse(result.content);
      if (parsed) { analysis = parsed; aiProvider = `${result.provider}:${result.model}`; }
    } catch (e) {
      console.error('[REJECTION-IA] AI failure:', (e as Error).message);
    }

    if (!analysis) {
      return new Response(JSON.stringify({ error: 'IA estratégica temporariamente indisponível. Tente novamente em instantes.' }), {
        status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Normalize components and compute score server-side (source of truth).
    const c = analysis.components || {};
    const components = {
      polarizacao: clamp(c.polarizacao),
      desgaste: clamp(c.desgaste),
      antagonismo_ideologico: clamp(c.antagonismo_ideologico),
      fragilidade_narrativa: clamp(c.fragilidade_narrativa),
      exposicao_negativa: clamp(c.exposicao_negativa),
      aprovacao: clamp(c.aprovacao),
      base_fiel: clamp(c.base_fiel),
      autoridade_institucional: clamp(c.autoridade_institucional),
    };

    const negativeScore =
      (components.polarizacao + components.desgaste + components.antagonismo_ideologico +
        components.fragilidade_narrativa + components.exposicao_negativa) / 5;
    const positiveShield =
      (components.aprovacao + components.base_fiel + components.autoridade_institucional) / 3;
    let rejeicaoFinal = negativeScore - (positiveShield * 0.35);

    // Redutor para presidentes em exercício (inferido pela autoridade institucional máxima)
    if (components.autoridade_institucional >= 90) {
      rejeicaoFinal *= 0.90;
    }

    const rejection_score = Math.max(0, Math.min(100, Math.round(rejeicaoFinal)));
    analysis.components = components;
    analysis.rejection_score = rejection_score;
    analysis.rejection_level = levelFromScore(rejection_score);
    analysis.negative_score = Math.round(negativeScore);
    analysis.positive_shield = Math.round(positiveShield);

    return new Response(JSON.stringify({
      analysis,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region, role_title: candidate.role_title },
      period: { key: periodKey, label: periodLabel, range_days: rangeDays, recent_weight: recentWeight, historical_weight: historicalWeight },
      ai_provider: aiProvider,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error analyzing rejection:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
