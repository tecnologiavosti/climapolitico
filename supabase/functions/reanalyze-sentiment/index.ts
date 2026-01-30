import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface SentimentResult {
  label: 'Positivo' | 'Negativo' | 'Neutro';
  score: number;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[]> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');

  if (!apiKey) {
    console.error('[SENTIMENT] LOVABLE_API_KEY not found');
    throw new Error('AI_NOT_CONFIGURED');
  }

  const clipped = texts.map((t) => (t || '').substring(0, 400).trim()).filter(t => t.length > 0);
  
  if (clipped.length === 0) {
    return texts.map(() => ({ label: 'Neutro', score: 0.5 }));
  }

  console.log(`[SENTIMENT] Analyzing ${clipped.length} comments...`);

  try {
    const systemPrompt = `Você é um especialista em análise de sentimento para comentários políticos em português brasileiro.

CLASSIFICAÇÃO OBRIGATÓRIA:

**POSITIVO** (score 0.7-1.0) - Comentários que expressam:
- Apoio direto: "te amo", "meu presidente", "parabéns", "voto em você"
- Elogios: "mito", "melhor", "orgulho", "herói"
- Expressões de torcida: "vai ganhar", "força", "estamos com você"
- Emojis positivos: ❤️ 👏 🇧🇷 💚💛 🙏 ✊
- Números de urna com apoio (22, 13, etc)
- Defesa do candidato contra críticas

**NEGATIVO** (score 0.0-0.3) - Comentários que expressam:
- Críticas: "ladrão", "corrupto", "mentiroso", "vagabundo"
- Rejeição: "fora", "nunca", "jamais"
- Xingamentos ou insultos
- Acusações de crimes ou má conduta
- Sarcasmo negativo ou ironia crítica
- Emojis negativos: 🤮 👎 😡 💩

**NEUTRO** (score 0.4-0.6) - APENAS para:
- Perguntas genuínas sem opinião
- Comentários puramente informativos
- Impossível determinar polaridade

REGRA CRÍTICA: Comentários curtos de apoio como "Lula presidente" ou "Parabéns Bolsonaro" são POSITIVOS, NÃO neutros!

Responda SOMENTE com um JSON array no formato: [{"label":"Positivo","score":0.85},{"label":"Negativo","score":0.15},...] na MESMA ordem dos comentários.`;

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
        max_tokens: clipped.length * 50 + 100,
      }),
    });

     if (!response.ok) {
       const errorText = await response.text().catch(() => '');
       console.error(`[SENTIMENT] API error ${response.status}:`, errorText);
       if (response.status === 429) throw new Error(`AI_RATE_LIMITED:${errorText}`);
       if (response.status === 402) throw new Error(`AI_CREDITS_EXHAUSTED:${errorText}`);
       throw new Error(`AI_GATEWAY_ERROR:${response.status}:${errorText}`);
     }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    const jsonMatch = content.match(/\[[\s\S]*?\]/);
     if (!jsonMatch) {
       console.error('[SENTIMENT] No JSON array found');
       throw new Error('AI_BAD_RESPONSE_NO_JSON');
     }

    let parsed: any[];
    try {
      parsed = JSON.parse(jsonMatch[0]);
     } catch {
       console.error('[SENTIMENT] JSON parse error');
       throw new Error('AI_BAD_RESPONSE_JSON_PARSE');
     }

     if (!Array.isArray(parsed) || parsed.length < texts.length) {
       throw new Error('AI_BAD_RESPONSE_SIZE');
     }

    const normalized: SentimentResult[] = texts.map((_, idx) => {
      const p = parsed[idx];
      if (!p) return { label: 'Neutro' as const, score: 0.5 };
      
      const label = (p?.label === 'Positivo' || p?.label === 'Negativo' || p?.label === 'Neutro') 
        ? p.label as 'Positivo' | 'Negativo' | 'Neutro'
        : 'Neutro';
      const score = typeof p?.score === 'number' ? Math.max(0, Math.min(1, p.score)) : 0.5;
      
      return { label, score };
    });

    return normalized;
   } catch (error) {
     console.error('[SENTIMENT] Analysis error:', error);
     throw error;
   }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Validate user
    const token = authHeader.replace('Bearer ', '');
    const { data: userData, error: authError } = await supabase.auth.getUser(token);

    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const userId = userData.user.id;
    console.log(`[REANALYZE] User: ${userId}`);

    // Parse request
    const { batchSize = 50, maxToProcess = 500 } = await req.json().catch(() => ({}));

    // Fetch broken comments (Neutro with score 0.5)
    const { data: brokenComments, error: fetchError } = await supabase
      .from('social_interactions')
      .select('id, comment_text')
      .eq('user_id', userId)
      .eq('sentiment_label', 'Neutro')
      .eq('sentiment_score', 0.5)
      .not('comment_text', 'is', null)
      .limit(maxToProcess);

    if (fetchError) {
      console.error('Fetch error:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch comments' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const toProcess = brokenComments || [];
    console.log(`[REANALYZE] Found ${toProcess.length} broken comments to reanalyze`);

    if (toProcess.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No broken comments found', stats: { processed: 0 } }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let processed = 0;
    let updated = 0;
    const sentimentCounts = { Positivo: 0, Negativo: 0, Neutro: 0 };

    // Process in batches
     for (const batch of chunkArray(toProcess, batchSize)) {
       const texts = batch.map(c => c.comment_text || '');
       let sentiments: SentimentResult[];
       try {
         sentiments = await analyzeSentimentBatch(texts);
       } catch (e: unknown) {
         const msg = e instanceof Error ? e.message : String(e);
         // Não prosseguir gravando "Neutro" por fallback — retornar erro para o cliente.
         if (msg.startsWith('AI_RATE_LIMITED')) {
           return new Response(
             JSON.stringify({ error: 'Rate limit do serviço de IA. Tente novamente em alguns minutos.', details: msg }),
             { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
           );
         }
         if (msg.startsWith('AI_CREDITS_EXHAUSTED')) {
           return new Response(
             JSON.stringify({ error: 'Créditos de IA esgotados. Adicione créditos para continuar.', details: msg }),
             { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
           );
         }
         return new Response(
           JSON.stringify({ error: 'Falha ao analisar sentimento no serviço de IA', details: msg }),
           { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
         );
       }

      // Update each comment
      for (let i = 0; i < batch.length; i++) {
        const comment = batch[i];
        const sentiment = sentiments[i];
        
         // Log explícito: entrada -> saída do modelo -> persistência
         console.log(`[REANALYZE] id=${comment.id} texto="${(comment.comment_text || '').substring(0, 120)}..." modelo=${sentiment.label} (${sentiment.score})`);

         // Only update if sentiment changed from default
        if (sentiment.label !== 'Neutro' || sentiment.score !== 0.5) {
          const { error: updateError } = await supabase
            .from('social_interactions')
            .update({
              sentiment_label: sentiment.label,
              sentiment_score: sentiment.score,
            })
            .eq('id', comment.id);

          if (!updateError) {
             console.log(`[REANALYZE] persistido id=${comment.id} label=${sentiment.label} score=${sentiment.score}`);
            updated++;
            sentimentCounts[sentiment.label]++;
          }
        } else {
          // Still neutro but now validated
          sentimentCounts.Neutro++;
        }
        processed++;
      }

      console.log(`[REANALYZE] Processed ${processed}/${toProcess.length}`);
      
      // Longer delay to avoid rate limits (2 seconds between batches)
      await new Promise(r => setTimeout(r, 2000));
    }

    // Recalculate metrics for affected candidates
    const candidateIds = [...new Set(toProcess.map(c => (c as any).candidate_id).filter(Boolean))];
    console.log(`[REANALYZE] Triggering metrics recalculation for ${candidateIds.length} candidates`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Reanalyzed ${processed} comments, updated ${updated}`,
        stats: {
          processed,
          updated,
          sentimentDistribution: sentimentCounts,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Reanalyze error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
