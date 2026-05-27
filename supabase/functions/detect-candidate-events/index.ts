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

// Confirmed live events (person participated in something concrete)
const EVENT_TYPES = new Set([
  'entrevista','debate','live','podcast','discurso','comicio',
  'coletiva','agenda','evento','programa','declaracao'
]);
// Other categories
const NEWS_TYPES = new Set(['noticia']);
const VIRAL_TYPES = new Set(['viral']);
const RUMOR_TYPES = new Set(['rumor']);
const VALID_TYPES = new Set([...EVENT_TYPES, ...NEWS_TYPES, ...VIRAL_TYPES, ...RUMOR_TYPES]);

// Trusted source signals — used to require ≥2 confirmations
const TRUSTED_SOURCES = [
  'cnn','globo','globonews','jornal nacional','jn','band','bandnews','sbt','record',
  'jovem pan','folha','estadao','estadão','uol','g1','veja','o globo','metropoles',
  'metrópoles','poder360','poder 360','agencia brasil','agência brasil','reuters',
  'congresso','senado','camara','câmara','planalto','tse','stf',
  'flow','inteligencia ltda','inteligência ltda','primo rico','podpah','pod','panico','pânico',
  'youtube','instagram live','twitch'
];
// Comment phrases hinting that there was a real public appearance
const APPEARANCE_HINTS = /\b(entrevist|debat|sabatin|coletiv|discurs|comici|comíci|inaugurac|inaugurac|visit|agend|reuniao|reunião|votac|sessao|sessão|live|podcast|programa|jornal|conferenc|palestra|congresso)\b/i;
// Viral-only signals (not an event)
const VIRAL_HINTS = /\b(viral|video viralizou|clip viralizou|meme|cortes|cortes do|polemica nas redes|polêmica nas redes|repercutiu nas redes)\b/i;
// Rumor signals
const RUMOR_HINTS = /\b(rumor|boato|fake news|desmente|desmentido|sem confirma|nao confirm|não confirm|circula nas redes)\b/i;

interface DetectedEvent {
  name: string;
  subtitle?: string;
  type: string;
  category?: 'evento' | 'noticia' | 'viral' | 'rumor';
  confidence?: number; // 0..1
  sources?: string[];  // trusted sources mentioned
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
    const sampleSource = all;

    if (sampleSource.length < 8) {
      return new Response(JSON.stringify({
        events: [],
        message: 'Dados insuficientes para detectar eventos reais. Colete mais interações sobre entrevistas, debates ou agendas.'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const sample = sampleSource.slice(0, 320).map((c) => {
      const date = (c.original_posted_at || c.created_at || '').substring(0, 10);
      return `[${date}|${c.social_network || '?'}] ${sanitize(c.comment_text).substring(0, 240)}`;
    });

    const prompt = `Você é um analista político brasileiro. Classifique acontecimentos sobre o candidato a partir dos comentários abaixo em 4 CATEGORIAS distintas:

Candidato: ${candidate.full_name}${candidate.party ? ` (${candidate.party})` : ''}.
Janela analisada: últimos ${monthsBack} meses.

CATEGORIAS (campo \`category\`):
1) "evento" — participação física ou digital CONFIRMADA do candidato (entrevista, debate, podcast, discurso, coletiva, comício, agenda pública, live, sessão/votação, programa de TV). REQUER: pelo menos UMA fonte oficial/confiável citada nos comentários (CNN, Globo, JN, Band, SBT, Record, G1, UOL, Folha, Estadão, Jovem Pan, Metrópoles, Poder360, Flow, Inteligência Ltda, Podpah, Câmara, Senado, Planalto, canal oficial). Se não houver fonte confiável citada, NÃO classifique como "evento".
2) "noticia" — acontecimento envolvendo o candidato mas SEM participação direta (ex.: "10 anos do impeachment", investigação, decisão judicial, repercussão histórica).
3) "viral" — vídeo, meme, corte ou publicação espontânea que viralizou (ex.: "vídeo em voo comercial", "meme do candidato").
4) "rumor" — boato, fake news, conteúdo não confirmado, "circula nas redes".

REGRAS:
- NÃO crie itens genéricos como "Pico de menções", "Aumento de comentários", "Atividade incomum".
- NÃO invente itens que não estão claramente mencionados.
- Cada item precisa de \`name\` real e identificável.
- \`type\` deve corresponder à categoria: para "evento" use entrevista|debate|live|podcast|discurso|comicio|coletiva|agenda|evento|programa|declaracao; para "noticia" use noticia; para "viral" use viral; para "rumor" use rumor.
- \`sources\`: lista das fontes/veículos confiáveis CITADAS nos comentários (use apenas se realmente aparecerem). Se vazio, não pode ser "evento".
- \`confidence\`: 0..1 — quantos sinais convergentes (fontes + nome de programa + data + volume).
- \`keywords\`: 4-10 termos curtos que aparecem nos comentários sobre o item.
- \`start_date\` (YYYY-MM-DD) estimada pelos timestamps.

COMENTÁRIOS (data|rede + texto):
${sample.join('\n')}

Responda APENAS com JSON válido (sem markdown):
{
  "events": [
    {
      "name": "Entrevista no Jornal Nacional",
      "subtitle": "Sobre economia",
      "category": "evento",
      "type": "entrevista",
      "sources": ["Globo","JN"],
      "confidence": 0.85,
      "location": "Globo",
      "keywords": ["jornal nacional","JN","bonner","globo"],
      "start_date": "2025-01-20",
      "end_date": "2025-01-20",
      "mentions_estimate": 42,
      "description": "Resumo em 1 linha."
    }
  ]
}`;

    let result: { events: DetectedEvent[] } = { events: [] };
    try {
      const aiRes = await callAICerebrasFirst({
        systemMsg: 'Você é um analista político que classifica acontecimentos em 4 categorias (evento, noticia, viral, rumor). NUNCA cria itens genéricos de "pico de menções". Só classifica como "evento" se houver pelo menos uma fonte oficial confiável citada nos comentários. Responde apenas em JSON válido.',
        userPrompt: prompt,
        jsonMode: true,
        maxTokens: 3500,
        temperature: 0.1,
        tag: 'detect-events',
      });
      const content = aiRes.content || '';
      try { result = JSON.parse(content); }
      catch {
        const m = content.match(/\{[\s\S]*\}/);
        if (m) result = JSON.parse(m[0]);
      }
      console.log(`[detect-events] ✅ ${aiRes.provider}:${aiRes.model} -> ${result.events?.length || 0} itens`);
    } catch (e) {
      console.error('[detect-events] AI failed:', (e as Error).message);
      result = { events: [] };
    }

    const isGenericName = (n: string) =>
      /pico de menc|aumento de coment|menc[ao]es em \d|surto de coment|atividade incomum|^\d+%/i.test(n);

    // Build a corpus of comment text for cross-validation
    const corpus = sampleSource.map(r => sanitize(r.comment_text!).toLowerCase()).join(' \n ');

    // Strict validation: real items only, valid type, keywords present, name not generic
    let events = (result.events || []).filter(e => {
      if (!e.name || isGenericName(e.name)) return false;
      if (!Array.isArray(e.keywords) || e.keywords.length < 2) return false;
      if (!e.start_date) return false;
      const type = (e.type || '').toLowerCase();
      if (!VALID_TYPES.has(type)) return false;

      // Cross-validate: at least 2 keywords must actually appear in the corpus
      const keywordHits = e.keywords.filter(k => k && corpus.includes(String(k).toLowerCase().trim())).length;
      if (keywordHits < 2) return false;

      return true;
    }).map(e => {
      const type = e.type.toLowerCase();
      // Infer category if missing, and downgrade "evento" without trusted source confirmation
      let category: 'evento' | 'noticia' | 'viral' | 'rumor' =
        (e.category as any) ||
        (VIRAL_TYPES.has(type) ? 'viral'
          : RUMOR_TYPES.has(type) ? 'rumor'
          : NEWS_TYPES.has(type) ? 'noticia'
          : 'evento');

      // Re-validate "evento" classification: must have ≥2 trusted signals
      if (category === 'evento') {
        const declaredSources = (e.sources || []).map(s => String(s).toLowerCase());
        const corpusSourceHits = TRUSTED_SOURCES.filter(s => corpus.includes(s));
        const allSources = Array.from(new Set([...declaredSources, ...corpusSourceHits.filter(s => declaredSources.some(d => d.includes(s) || s.includes(d)) || corpus.includes(s))]));
        const hasAppearanceHint = APPEARANCE_HINTS.test(corpus) || APPEARANCE_HINTS.test(e.name);
        const signals = (allSources.length >= 1 ? 1 : 0) + (hasAppearanceHint ? 1 : 0) + ((e.confidence || 0) >= 0.7 ? 1 : 0);
        if (signals < 2) {
          // Downgrade to noticia if it has source-like context, otherwise viral
          category = allSources.length > 0 || hasAppearanceHint ? 'noticia' : (VIRAL_HINTS.test(corpus) ? 'viral' : 'noticia');
        }
        e.sources = allSources.slice(0, 6);
      }

      // Rumor override
      if (RUMOR_HINTS.test(e.name) || RUMOR_HINTS.test(e.description || '')) category = 'rumor';

      return { ...e, type, category };
    });

    // Semantic dedup: group near-duplicate names within same category
    const grouped: DetectedEvent[] = [];
    for (const ev of events) {
      const evTok = tokens(ev.name);
      const dup = grouped.find(g => jaccard(tokens(g.name), evTok) >= 0.45 && g.category === ev.category);
      if (dup) {
        dup.mentions_estimate = (dup.mentions_estimate || 0) + (ev.mentions_estimate || 0);
        dup.keywords = Array.from(new Set([...(dup.keywords || []), ...(ev.keywords || [])])).slice(0, 12);
        dup.sources = Array.from(new Set([...(dup.sources || []), ...(ev.sources || [])])).slice(0, 6);
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
              sources: ev.sources || [],
              category: ev.category || 'evento',
              confidence: ev.confidence ?? 0.5,
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
