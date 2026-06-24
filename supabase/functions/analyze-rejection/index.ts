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

function levelFromScore(score: number): 'baixa' | 'moderada' | 'alta' {
  if (score <= 30) return 'baixa';
  if (score <= 60) return 'moderada';
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

    const { candidateId } = await req.json();
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

    const systemMsg = `Você é um estrategista político sênior brasileiro especializado em inteligência reputacional preditiva e war room eleitoral. Sua análise é 100% inferencial — você NÃO usa comentários reais, menções, posts ou evidências coletadas. Você infere a rejeição estritamente a partir do perfil político do candidato: cargo, partido, ideologia, região, rivalidades, trajetória pública conhecida e arquétipo narrativo. Nunca cite "comentários", "evidências", "menções" ou "posts coletados". Toda frase representativa que você gerar é SIMULADA por IA com base em padrões narrativos brasileiros — nunca apresentada como real. Responda sempre em português do Brasil.`;

    const userPrompt = `CANDIDATO ALVO:
- Nome: ${candidate.full_name}
- Partido: ${candidate.party || 'não informado'}
- Região/UF: ${candidate.region || 'não informada'}
- Cargo/posição: ${(candidate as any).position || 'não informado'}
- Ideologia presumida: ${(candidate as any).ideology || 'inferir a partir do partido e perfil público'}

TAREFA — INTELIGÊNCIA PREDITIVA DE REJEIÇÃO (sem usar dados coletados):

Calcule um score de rejeição (0–100) como a média de 5 componentes (0–100 cada):
1. polarizacao — quanto divide opiniões (ex.: Lula alto, prefeito técnico baixo).
2. desgaste — tempo de exposição pública e histórico (presidente alto, novato baixo).
3. antagonismo_ideologico — rejeição em grupos opostos (direita vs esquerda, agro vs urbano progressista).
4. fragilidade_narrativa — facilidade de ataque (corrupção, velha política, elitismo, radicalismo, inexperiência).
5. exposicao_negativa — probabilidade de narrativas negativas ganharem força.

Responda EXCLUSIVAMENTE em JSON válido no formato:
{
  "components": {
    "polarizacao": 0-100,
    "desgaste": 0-100,
    "antagonismo_ideologico": 0-100,
    "fragilidade_narrativa": 0-100,
    "exposicao_negativa": 0-100
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
    };
    const rejection_score = Math.round(
      (components.polarizacao + components.desgaste + components.antagonismo_ideologico +
        components.fragilidade_narrativa + components.exposicao_negativa) / 5
    );
    analysis.components = components;
    analysis.rejection_score = rejection_score;
    analysis.rejection_level = levelFromScore(rejection_score);

    return new Response(JSON.stringify({
      analysis,
      candidate: { id: candidate.id, full_name: candidate.full_name, party: candidate.party, region: candidate.region },
      ai_provider: aiProvider,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error analyzing rejection:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
