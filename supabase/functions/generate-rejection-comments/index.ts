import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface GroupIn {
  profile: string;
  reason: string;
}

interface GroupOut {
  profile: string;
  reason: string;
  objective: string;
  tone: string;
  comments: { type: string; text: string }[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const { candidateId, groups, variation } = body || {};
    if (!candidateId || !Array.isArray(groups) || groups.length === 0) {
      return new Response(JSON.stringify({ error: 'candidateId e groups são obrigatórios' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: candidate } = await supabaseClient
      .from('candidates')
      .select('full_name, party, region')
      .eq('id', candidateId)
      .single();

    if (!candidate) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const groupsList = (groups as GroupIn[])
      .slice(0, 8)
      .map((g, i) => `${i + 1}. ${g.profile} — Motivo: ${g.reason}`)
      .join('\n');

    const systemMsg = `Você é estrategista de comunicação política brasileira especializado em redes sociais.
Gere comentários e posts práticos para REDUZIR rejeição emocional de cada grupo.
REGRAS:
- Soar como fala real de político brasileiro (humano, não robótico).
- Frases curtas, diretas, emocionais.
- Usar linguagem regional quando fizer sentido.
- Evitar promessas vazias e jargão técnico.
- Nunca atacar o eleitor; sempre escutar/incluir.
Responda APENAS com JSON válido.`;

    const userPrompt = `Candidato: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}${candidate.region ? ` — ${candidate.region}` : ''}

Grupos que mais rejeitam:
${groupsList}

Variação solicitada: ${variation ?? 1} (gere abordagens diferentes a cada variação).

Para CADA grupo, gere:
- objective: objetivo de comunicação (1 frase)
- tone: tom ideal (1 frase curta)
- comments: 4 itens, um de cada tipo, na ordem:
  1. "Resposta para comentário negativo"
  2. "Comentário fixado em post"
  3. "Story / legenda curta"
  4. "Tweet / post de impacto"

Formato JSON:
{
  "groups": [
    {
      "profile": "...",
      "reason": "...",
      "objective": "...",
      "tone": "...",
      "comments": [
        { "type": "Resposta para comentário negativo", "text": "..." },
        { "type": "Comentário fixado em post", "text": "..." },
        { "type": "Story / legenda curta", "text": "..." },
        { "type": "Tweet / post de impacto", "text": "..." }
      ]
    }
  ]
}`;

    const result = await callAICerebrasFirst({
      systemMsg,
      userPrompt,
      jsonMode: true,
      maxTokens: 3500,
      temperature: 0.85,
      tag: 'generate-rejection-comments',
    });

    let parsed: { groups: GroupOut[] } = { groups: [] };
    try {
      parsed = JSON.parse(result.content);
    } catch {
      const m = result.content.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    return new Response(JSON.stringify({ groups: parsed.groups ?? [] }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('generate-rejection-comments error:', err);
    return new Response(JSON.stringify({ error: err?.message ?? 'Erro inesperado' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
