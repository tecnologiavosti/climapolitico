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

interface DetectedEvent {
  name: string;
  type: string;
  keywords: string[];
  start_date: string; // YYYY-MM-DD
  end_date: string;
  mentions_estimate: number;
  description: string;
}

const STOP = new Set([
  'para','como','mais','muito','pela','pelo','isso','essa','esse','esta','este','entre','sobre','quando','onde','tambem','também','presidente','candidato','candidata','brasil','politica','política','governo','partido','povo','gente','tudo','todos','todas','agora','hoje','ontem','sempre','nunca','assim','porque','porquê','mesmo','quem','vou','tem','tinha','foi','sao','são','dos','das','com','sem','por','seu','sua','meu','minha','nos','nas','que','dele','dela','aqui','ali','ainda','depois','antes','tao','tão','pouco','bom','boa','ruim'
]);

function tokenize(text: string): string[] {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]{4,}/g) || [];
}

function heuristicEvents(comments: any[]): DetectedEvent[] {
  if (comments.length < 10) return [];
  const byDay = new Map<string, any[]>();
  for (const c of comments) {
    const day = ((c.original_posted_at || c.created_at) || '').substring(0, 10);
    if (!day) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(c);
  }
  const days = [...byDay.entries()].sort();
  if (days.length === 0) return [];
  const totals = days.map(([, arr]) => arr.length);
  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  const peakDays = days.filter(([, arr]) => arr.length >= Math.max(5, avg * 1.5));

  const events: DetectedEvent[] = [];
  for (const [day, arr] of peakDays) {
    const wordCounts = new Map<string, number>();
    for (const c of arr) {
      const seen = new Set<string>();
      for (const w of tokenize(sanitize(c.comment_text))) {
        if (STOP.has(w) || /^\d+$/.test(w)) continue;
        if (seen.has(w)) continue;
        seen.add(w);
        wordCounts.set(w, (wordCounts.get(w) || 0) + 1);
      }
    }
    const top = [...wordCounts.entries()]
      .filter(([, n]) => n >= Math.max(3, Math.floor(arr.length * 0.15)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
    if (top.length < 2) continue;
    events.push({
      name: `Pico de menções em ${day} — ${top.slice(0, 2).join(', ')}`,
      type: 'pico',
      keywords: top,
      start_date: day,
      end_date: day,
      mentions_estimate: arr.length,
      description: `Concentração atípica de comentários em ${day}. Termos recorrentes: ${top.join(', ')}.`,
    });
    if (events.length >= 8) break;
  }
  return events;
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

    // Semantic dedup: group near-duplicate event names ("Flávio na CNN", "Entrevista CNN", ...)
    const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const tokens = (s: string) => new Set(normalize(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)));
    const jaccard = (a: Set<string>, b: Set<string>) => {
      if (!a.size || !b.size) return 0;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter++;
      return inter / (a.size + b.size - inter);
    };
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

    // Persist to political_events so the UI list (which reads from the table) reflects the result.
    let saved: any[] = [];
    if (events.length > 0) {
      // Avoid creating duplicates of events already saved (match by normalized name within ±2 days)
      const { data: existing } = await supabaseService
        .from('political_events')
        .select('id, event_name, event_date, event_type')
        .eq('candidate_id', candidateId)
        .eq('user_id', user.id);

      const existingNorm = (existing || []).map((r: any) => ({
        ...r,
        norm: normalize(r.event_name),
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
          reused.push({ id: match.id, ...ev });
        } else {
          toInsert.push({
            user_id: user.id,
            candidate_id: candidateId,
            event_name: ev.name.substring(0, 200),
            event_type: ev.type || 'outro',
            event_date: new Date(`${ev.start_date}T12:00:00Z`).toISOString(),
            description: ev.description?.substring(0, 500) || null,
            keywords: (ev.keywords || []).slice(0, 15),
            metadata: { mentions_estimate: ev.mentions_estimate || 0, end_date: ev.end_date, auto_detected: true },
          });
        }
      }

      if (toInsert.length > 0) {
        const { data: inserted, error: insertErr } = await supabaseService
          .from('political_events')
          .insert(toInsert)
          .select('id, event_name, event_type, event_date, keywords, metadata');
        if (insertErr) console.error('[detect-events] insert error:', insertErr.message);
        saved = [...(inserted || []), ...reused];
      } else {
        saved = reused;
      }
    }

    return new Response(JSON.stringify({
      events: saved.length > 0 ? saved : events,
      saved_count: saved.length,
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
