import { assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";

type SentimentLabel = 'Positivo' | 'Negativo' | 'Neutro';

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

Deno.test('Sanidade do sentimento: não pode virar tudo Neutro', async () => {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  if (!apiKey) {
    console.warn('LOVABLE_API_KEY ausente; pulando teste.');
    return;
  }

  const tests: Array<{ text: string; expected: SentimentLabel }> = [
    { text: 'FLÁVIO BOLSONARO PRESIDENTE 🇧🇷', expected: 'Positivo' },
    { text: 'Parabéns Flávio, estamos com você!', expected: 'Positivo' },
    { text: 'Bolsonaro o melhor presidente de todos os tempos', expected: 'Positivo' },
    { text: 'O SBT se vendeu ao governo vigente, ninguém tem dúvidas sobre isso', expected: 'Negativo' },
    { text: 'Depois do papelão que fez, não muda em nada a opinião da população', expected: 'Negativo' },
  ];

  const systemPrompt = `Você é um especialista em análise de sentimento para comentários políticos em português brasileiro.

Classifique cada texto como Positivo (0.7-1.0), Negativo (0.0-0.3) ou Neutro (0.4-0.6).
REGRA CRÍTICA: frases curtas de apoio como "Fulano presidente" são POSITIVAS.
Responda SOMENTE com JSON array: [{"label":"Positivo","score":0.85}, ...] na MESMA ordem.`;

  const userContent = tests.map((t, i) => `${i + 1}. "${t.text}"`).join('\n');

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
        { role: 'user', content: `Analise:\n\n${userContent}` },
      ],
      temperature: 0.1,
      max_tokens: tests.length * 60 + 200,
    }),
  });

  assert(response.ok, `Gateway retornou ${response.status}`);

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  assert(jsonMatch, 'Sem JSON array na resposta');

  const parsed = JSON.parse(jsonMatch![0]);
  assert(Array.isArray(parsed), 'Resposta não é array');
  assert(parsed.length >= tests.length, 'Array menor do que o esperado');

  const results = tests.map((_, idx) => {
    const p = parsed[idx];
    const label: SentimentLabel = (p?.label === 'Positivo' || p?.label === 'Negativo' || p?.label === 'Neutro') ? p.label : 'Neutro';
    const score = typeof p?.score === 'number' ? clamp01(p.score) : 0.5;
    return { label, score };
  });

  const allNeutral = results.every((r) => r.label === 'Neutro');
  assert(!allNeutral, 'Falha: todos os casos ficaram como Neutro');
});
