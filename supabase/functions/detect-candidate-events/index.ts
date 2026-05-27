import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAICerebrasFirst } from "../_shared/cerebras-ai.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
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

const VALID_TYPES = new Set([
  'entrevista','debate','live','podcast','discurso','comicio','noticia',
  'coletiva','agenda','evento','programa','declaracao'
]);

// Keywords that indicate the comment refers to a real event (not just random chatter)
const EVENT_HINTS = /\b(entrevist|debat|podcast|live|coletiv|programa|jornal|telejornal|sabatin|cnn|globo|band|sbt|record|jovem pan|globonews|gloob|jn\b|flow|inteligencia ltda|primo rico|pod|youtube|instagram live|comicio|discurso|palestra|conferencia|encontro|reuniao|inaugurac|visita|agenda|plenario|votacao|sessao|congresso|senado|camara)\b/i;

interface DetectedEvent {
  name: string;
  subtitle?: string;
  type: string;
  keywords: string[];
  start_date: string; // YYYY-MM-DD
  end_date: string;
  mentions_estimate: number;
  description: string;
  location?: string;
  source?: string;
}

const STOP = new Set([
  'para','como','mais','muito','pela','pelo','isso','essa','esse','esta','este','entre','sobre','quando','onde','tambem','também','presidente','candidato','candidata','brasil','politica','política','governo','partido','povo','gente','tudo','todos','todas','agora','hoje','ontem','sempre','nunca','assim','porque','porquê','mesmo','quem','vou','tem','tinha','foi','sao','são','dos','das','com','sem','por','seu','sua','meu','minha','nos','nas','que','dele','dela','aqui','ali','ainda','depois','antes','tao','tão','pouco','bom','boa','ruim'
]);

const normalize = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
   .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

const tokens = (s: string) =>
  new Set(normalize(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)));

const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

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

    // Pull comments that look like they're talking about a real event
    const { data: rows } = await supabaseClient
      .from('social_interactions')
      .select('comment_text, original_posted_at, created_at, likes_count, replies_count, social_network')
      .eq('candidate_id', candidateId)
      .or(`original_posted_at.gte.${sinceISO},and(original_posted_at.is.null,created_at.gte.${sinceISO})`)
      .not('comment_text', 'is', null)
      .order('likes_count', { ascending: false, nullsFirst: false })
      .limit(1200);

    const all = (rows || []).filter(r => r.comment_text && r.comment_text.trim().length > 12);
    // Prioritize event-hint comments, but keep some context
    const eventish = all.filter(r => EVENT_HINTS.test(r.comment_text!));
    const sampleSource = eventish.length >= 25 ? eventish : all;

    if (sampleSource.length < 8) {
      return new Response(JSON.stringify({
        events: [],
        message: 'Dados insuficientes para detectar eventos reais. Colete mais interações sobre entrevistas, debates ou agendas.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sample = sampleSource.slice(0, 280).map((c) => {
      const date = (c.original_posted_at || c.created_at || '').substring(0, 10);
      return `[${date}|${c.social_network || '?'}] ${sanitize(c.comment_text).substring(0, 240)}`;
    });

    const prompt = `Você é um analista político brasileiro especializado em detectar EVENTOS REAIS sobre um candidato a partir de comentários de redes sociais e notícias.

Candidato: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}.
Janela analisada: últimos ${monthsBack} meses.

Sua tarefa: identificar **acontecimentos reais e concretos** que geraram repercussão. Apenas:
- entrevistas (em telejornais, podcasts, rádios, programas)
- debates
- lives/transmissões
- podcasts específicos (ex: Flow, Inteligência Ltda, Primo Rico)
- discursos / pronunciamentos / coletivas de imprensa
- comícios / agendas públicas / inaugurações / visitas
- notícias políticas relevantes envolvendo o candidato
- votações / sessões / declarações públicas pontuais

REGRAS RÍGIDAS:
- **NÃO** crie eventos genéricos como "Pico de menções", "Aumento de comentários" ou nomes vazios com palavras avulsas.
- **NÃO** invente eventos que não estão claramente mencionados nos comentários.
- Cada evento precisa ter um **nome real e identificável** (ex.: "Entrevista no Jornal Nacional", "Debate Globo 2024", "Live no Flow Podcast", "Discurso na Câmara sobre segurança").
- Inclua um \`subtitle\` curto descrevendo o tema central (ex.: "Sobre economia e reforma tributária").
- Inclua \`location\` quando aparecer no contexto (cidade ou veículo/programa).
- Use \`type\` apenas dos valores permitidos: entrevista, debate, live, podcast, discurso, comicio, noticia, coletiva, agenda, evento, programa, declaracao.
- Estime \`start_date\` (YYYY-MM-DD) com base nos timestamps dos comentários relacionados.
- \`keywords\` = 4-10 termos curtos que apareçam nos comentários sobre o evento (ex.: ["jornal nacional","bonner","JN","globo"]).
- Se NÃO houver evidência clara de evento real, retorne lista vazia. Melhor vazio do que inventado.

COMENTÁRIOS (data|rede + texto):
${sample.join('\n')}

Responda APENAS com JSON válido (sem markdown, sem comentários):
{
  "events": [
    {
      "name": "Entrevista no Jornal Nacional",
      "subtitle": "Sobre economia e gestão pública",
      "type": "entrevista",
      "location": "Globo / Rio de Janeiro",
      "source": "Globo",
      "keywords": ["jornal nacional","JN","bonner","globo"],
      "start_date": "2025-XX-XX",
      "end_date": "2025-XX-XX",
      "mentions_estimate": 42,
      "description": "Breve descrição do evento em 1 linha."
    }
  ]
}`;

    let result: { events: DetectedEvent[] } = { events: [] };
    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: 'Você é um analista político que extrai EVENTOS REAIS (entrevistas, debates, podcasts, comícios, notícias) de comentários. NUNCA cria eventos genéricos de "pico de menções". Responde apenas em JSON válido.',
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 3000,
        temperature: 0.15,
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
      console.error('[detect-events] AI failed:', (e as Error).message);
      result = { events: [] };
    }

    // Strict validation: real events only, valid type, keywords present, name not generic
    const isGenericName = (n: string) =>
      /pico de menc|aumento de coment|menc[ao]es em \d|surto de coment|atividade incomum/i.test(n);

    let events = (result.events || []).filter(e =>
      e.name &&
      !isGenericName(e.name) &&
      Array.isArray(e.keywords) && e.keywords.length >= 2 &&
      e.start_date &&
      VALID_TYPES.has((e.type || '').toLowerCase())
    ).map(e => ({ ...e, type: e.type.toLowerCase() }));

    // Semantic dedup: group near-duplicate event names
    const grouped: DetectedEvent[] = [];
    for (const ev of events) {
      const evTok = tokens(ev.name);
      const dup = grouped.find(g => jaccard(tokens(g.name), evTok) >= 0.45 && g.type === ev.type);
      if (dup) {
        dup.mentions_estimate = (dup.mentions_estimate || 0) + (ev.mentions_estimate || 0);
        dup.keywords = Array.from(new Set([...(dup.keywords || []), ...(ev.keywords || [])])).slice(0, 12);
      } else {
        grouped.push({ ...ev });
      }
    }
    events = grouped;

    // Persist new ones, reuse existing matches (±3 days)
    let saved: any[] = [];
    if (events.length > 0) {
      const { data: existing } = await supabaseService
        .from('political_events')
        .select('id, event_name, event_date, event_type, keywords, metadata, description')
        .eq('candidate_id', candidateId)
        .eq('user_id', user.id);

      const existingNorm = (existing || []).map((r: any) => ({
        ...r,
        tok: tokens(r.event_name),
        t: new Date(r.event_date).getTime(),
      }));

      const toInsert: any[] = [];
      const reused: any[] = [];
      for (const ev of events) {
        const evTok = tokens(ev.name);
        const evDate = new Date(`${ev.start_date}T12:00:00Z`).getTime();
        const match = existingNorm.find(r => r.event_type === ev.type && jaccard(r.tok, evTok) >= 0.45 && Math.abs(r.t - evDate) <= 3 * 86400000);
        if (match) {
          reused.push(match);
        } else {
          toInsert.push({
            user_id: user.id,
            candidate_id: candidateId,
            event_name: ev.name.substring(0, 200),
            event_type: ev.type,
            event_date: new Date(`${ev.start_date}T12:00:00Z`).toISOString(),
            description: ev.description?.substring(0, 500) || ev.subtitle?.substring(0, 500) || null,
            keywords: (ev.keywords || []).slice(0, 15),
            metadata: {
              mentions_estimate: ev.mentions_estimate || 0,
              end_date: ev.end_date,
              subtitle: ev.subtitle || null,
              location: ev.location || null,
              source: ev.source || null,
              auto_detected: true,
            },
          });
        }
      }

      if (toInsert.length > 0) {
        const { data: inserted, error: insertErr } = await supabaseService
          .from('political_events')
          .insert(toInsert)
          .select('id, event_name, event_type, event_date, keywords, metadata, description');
        if (insertErr) console.error('[detect-events] insert error:', insertErr.message);
        saved = [...(inserted || []), ...reused];
      } else {
        saved = reused;
      }
    }

    // Also delete legacy "pico" / generic events for this candidate so the UI is clean
    try {
      await supabaseService
        .from('political_events')
        .delete()
        .eq('candidate_id', candidateId)
        .eq('user_id', user.id)
        .eq('event_type', 'pico');
    } catch (e) { /* ignore */ }

    return new Response(JSON.stringify({
      events: saved,
      saved_count: saved.length,
      candidate: { id: candidate.id, full_name: candidate.full_name },
      analyzed_comments: sampleSource.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Erro' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
