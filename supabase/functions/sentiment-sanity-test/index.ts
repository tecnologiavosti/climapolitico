import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type SentimentLabel = 'Positivo' | 'Negativo' | 'Neutro';

interface SentimentResult {
  label: SentimentLabel;
  score: number;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

async function analyzeSentimentBatch(texts: string[], requestId: string): Promise<SentimentResult[]> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) throw new Error('LOVABLE_API_KEY ausente');

  const clipped = texts.map((t) => (t || '').substring(0, 400).trim());
  if (clipped.length === 0) throw new Error('Nenhum texto para analisar');

  const systemPrompt = `Você é um especialista em análise de sentimento para comentários políticos em português brasileiro.

CLASSIFICAÇÃO OBRIGATÓRIA:

**POSITIVO** (score 0.7-1.0) - Apoio explícito, intenção de voto, elogios, torcida.
Exemplos: "PRESIDENTE", "parabéns", "melhor", "mito", números de urna (22, 13), emojis ❤️ 👏 🇧🇷 💚💛 🙏

**NEGATIVO** (score 0.0-0.3) - Críticas diretas, rejeição, acusações, sarcasmo negativo, xingamentos.

**NEUTRO** (score 0.4-0.6) - APENAS informativo/pergunta genuína/off-topic.

REGRA CRÍTICA: frases curtas de apoio como "Fulano presidente" são POSITIVAS, NÃO neutras.

Responda SOMENTE com um JSON array no formato: [{"label":"Positivo","score":0.85},{"label":"Negativo","score":0.15},...] na MESMA ordem.`;

  const userContent = clipped.map((text, i) => `${i + 1}. "${text}"`).join('\n');

  const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Analise o sentimento político de cada comentário abaixo:\n\n${userContent}` },
      ],
      temperature: 0.1,
      max_tokens: clipped.length * 60 + 200,
    }),
  });

  if (!response.ok) {
    const t = await response.text().catch(() => '');
    throw new Error(`Gateway erro ${response.status}: ${t.substring(0, 500)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  console.log(`[SANITY:${requestId}] Saída bruta (500): ${content.substring(0, 500)}`);

  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) throw new Error('Sem JSON array na resposta');

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed) || parsed.length < texts.length) {
    throw new Error(`Tamanho inesperado: retornou ${parsed?.length}, esperado ${texts.length}`);
  }

  return texts.map((_, idx) => {
    const p = parsed[idx];
    const label: SentimentLabel = (p?.label === 'Positivo' || p?.label === 'Negativo' || p?.label === 'Neutro') ? p.label : 'Neutro';
    const score = typeof p?.score === 'number' ? clamp01(p.score) : 0.5;
    return { label, score };
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));

    const tests: Array<{ text: string; expected: SentimentLabel }> = Array.isArray(body?.tests)
      ? body.tests
      : [
          { text: 'FLÁVIO BOLSONARO PRESIDENTE 🇧🇷', expected: 'Positivo' },
          { text: 'Parabéns Flávio, estamos com você!', expected: 'Positivo' },
          { text: 'Bolsonaro o melhor presidente de todos os tempos', expected: 'Positivo' },
          { text: 'O SBT se vendeu ao governo vigente, ninguém tem dúvidas sobre isso', expected: 'Negativo' },
          { text: 'Depois do papelão que fez, não muda em nada a opinião da população', expected: 'Negativo' },
        ];

    const texts = tests.map((t) => t.text);
    console.log(`[SANITY:${requestId}] Rodando teste de sanidade com ${texts.length} frases`);

    const results = await analyzeSentimentBatch(texts, requestId);

    const detailed = tests.map((t, i) => {
      const r = results[i];
      return {
        text: t.text,
        expected: t.expected,
        label: r?.label,
        score: r?.score,
        ok: r?.label === t.expected,
      };
    });

    // Regras mínimas do sanity:
    // - não pode ser tudo Neutro
    // - precisa acertar pelo menos os casos óbvios (esperado)
    const allNeutral = detailed.every((d) => d.label === 'Neutro');
    const okCount = detailed.filter((d) => d.ok).length;
    const pass = !allNeutral && okCount >= Math.ceil(detailed.length * 0.7);

    // Logs: entrada -> saída -> status
    for (const d of detailed) {
      console.log(`[SANITY:${requestId}] "${d.text.substring(0, 80)}..." | esperado=${d.expected} | obtido=${d.label} (${d.score}) | ok=${d.ok}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        pass,
        okCount,
        total: detailed.length,
        allNeutral,
        results: detailed,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`[SANITY:${requestId}] Erro:`, error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
