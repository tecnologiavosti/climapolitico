import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

function sanitize(s: unknown): string {
  if (s == null) return "";
  let str = String(s);
  str = str.replace(/<[^>]*>/g, " ").replace(/https?:\/\/\S+/gi, " ");
  str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
  str = str.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "");
  str = str.replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
  return str.replace(/\s+/g, " ").trim();
}

interface DetectedEvent {
  name: string;
  type: string;
  keywords: string[];
  start_date: string; // YYYY-MM-DD
  end_date: string;
  mentions_estimate: number;
  description: string;
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
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { candidateId, monthsBack = 3 } = await req.json();
    if (!candidateId) {
      return new Response(JSON.stringify({ error: 'candidateId obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: candidate } = await supabaseService
      .from('candidates')
      .select('id, full_name, party, user_id')
      .eq('id', candidateId)
      .maybeSingle();

    if (!candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const since = new Date();
    since.setMonth(since.getMonth() - monthsBack);
    const sinceISO = since.toISOString();

    // Pull a sample of comments from the period (most engaged + recent)
    const { data: rows } = await supabaseClient
      .from('social_interactions')
      .select('comment_text, original_posted_at, created_at, likes_count, replies_count')
      .eq('candidate_id', candidateId)
      .or(`original_posted_at.gte.${sinceISO},and(original_posted_at.is.null,created_at.gte.${sinceISO})`)
      .not('comment_text', 'is', null)
      .order('likes_count', { ascending: false, nullsFirst: false })
      .limit(800);

    const comments = (rows || []).filter(r => r.comment_text && r.comment_text.trim().length > 10);

    if (comments.length < 5) {
      return new Response(JSON.stringify({
        events: [],
        message: 'Dados insuficientes para detectar eventos. Colete mais interações.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sample = comments.slice(0, 250).map((c, i) => {
      const date = (c.original_posted_at || c.created_at || '').substring(0, 10);
      return `[${date}] ${sanitize(c.comment_text).substring(0, 220)}`;
    });

    const prompt = `Você é um analista político brasileiro. Abaixo estão comentários públicos sobre o candidato ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''} dos últimos ${monthsBack} meses.

Sua tarefa: identificar EVENTOS ESPECÍFICOS sobre os quais as pessoas comentaram (entrevistas em telejornais, debates, programas, falas polêmicas, comícios, viagens oficiais, votações, declarações públicas, etc.).

REGRAS:
- Liste apenas eventos com VOLUME RELEVANTE de comentários (pelo menos 3 menções claras).
- Para cada evento, forneça palavras-chave/termos que aparecem nos comentários sobre ele (ex: "jornal nacional", "william bonner", "JN", "globo").
- Use o nome real do evento como aparece nos comentários.
- Estime as datas com base nos timestamps dos comentários relacionados.
- NÃO invente eventos. Se não há padrão claro, retorne lista vazia.

COMENTÁRIOS (data e texto):
${sample.join('\n')}

Responda APENAS com JSON válido (sem markdown):
{
  "events": [
    {
      "name": "Entrevista no Jornal Nacional",
      "type": "entrevista|debate|comício|fala|programa|votação|outro",
      "keywords": ["jornal nacional", "JN", "bonner"],
      "start_date": "2025-XX-XX",
      "end_date": "2025-XX-XX",
      "mentions_estimate": 42,
      "description": "Breve descrição do evento em 1 linha"
    }
  ]
}`;

    let result: { events: DetectedEvent[] } = { events: [] };
    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: 'Você é um analista político que extrai eventos de comentários. Responde apenas em JSON válido.',
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 2500,
        temperature: 0.2,
        tag: 'detect-events',
      });
      const content = aiRes.content || '';
      try { result = JSON.parse(content); }
      catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) result = JSON.parse(m[0]);
      }
      console.log(`[detect-events] ✅ ${aiRes.provider}:${aiRes.model} -> ${result.events?.length || 0} eventos`);
    } catch (e) {
      console.error('[detect-events] AI failed, using heuristic fallback:', (e as Error).message);
      result = { events: heuristicEvents(comments) };
    }

    let events = (result.events || []).filter(e => e.name && e.keywords?.length && e.start_date);
    if (events.length === 0) {
      // Always offer at least the heuristic fallback so the dropdown is never empty when there is data
      events = heuristicEvents(comments);
    }

    return new Response(JSON.stringify({
      events,
      candidate: { id: candidate.id, full_name: candidate.full_name },
      analyzed_comments: comments.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
