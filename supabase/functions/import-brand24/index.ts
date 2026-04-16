import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Brand24Mention {
  date: string;
  author: string;
  authorUrl?: string;
  source: string;
  sourceType: string;
  content: string;
  sentiment?: string;
  sentimentScore?: number;
  reach?: number;
  interactions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  url?: string;
}

interface SentimentResult {
  label: string;
  score: number;
}

function mapSourceToNetwork(source: string, sourceType: string): string {
  const s = (source || '').toLowerCase();
  const t = (sourceType || '').toLowerCase();
  
  if (s.includes('twitter') || s.includes('x.com') || t.includes('twitter')) return 'twitter';
  if (s.includes('facebook') || t.includes('facebook')) return 'facebook';
  if (s.includes('instagram') || t.includes('instagram')) return 'instagram';
  if (s.includes('youtube') || t.includes('youtube')) return 'youtube';
  if (s.includes('tiktok') || t.includes('tiktok')) return 'tiktok';
  if (s.includes('reddit') || t.includes('reddit')) return 'reddit';
  if (s.includes('linkedin') || t.includes('linkedin')) return 'linkedin';
  if (t.includes('news') || t.includes('blog') || t.includes('web')) return 'news';
  if (t.includes('forum')) return 'forum';
  return 'other';
}

function mapBrand24Sentiment(sentiment: string | undefined): { label: string | null; score: number | null } {
  if (!sentiment) return { label: null, score: null };
  const s = sentiment.toLowerCase().trim();
  if (s === 'positive' || s === 'positivo') return { label: 'Positivo', score: 0.8 };
  if (s === 'negative' || s === 'negativo') return { label: 'Negativo', score: 0.2 };
  if (s === 'neutral' || s === 'neutro') return { label: 'Neutro', score: 0.5 };
  return { label: null, score: null };
}

async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY || texts.length === 0) return null;

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Você é um especialista em análise de sentimento político brasileiro. Classifique cada comentário como Positivo (0.7-1.0), Negativo (0.0-0.3), ou Neutro (0.4-0.6). Responda APENAS com JSON array.`
          },
          {
            role: 'user',
            content: `Analise:\n${texts.map((t, i) => `${i + 1}. "${t.substring(0, 300)}"`).join('\n')}\n\nRetorne JSON array: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0}]`
          }
        ],
        temperature: 0.1,
        max_tokens: texts.length * 50 + 100,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) return null;
    const results: SentimentResult[] = JSON.parse(match[0]);
    if (!Array.isArray(results) || results.length < texts.length) return null;
    return results;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Autenticação necessária' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const body = await req.json();
    const { mentions, candidate_id, reanalyze_sentiment = false } = body as {
      mentions: Brand24Mention[];
      candidate_id: string;
      reanalyze_sentiment?: boolean;
    };

    if (!mentions || !Array.isArray(mentions) || mentions.length === 0) {
      return new Response(JSON.stringify({ error: 'Array de menções é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (!candidate_id) {
      return new Response(JSON.stringify({ error: 'candidate_id é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (mentions.length > 500) {
      return new Response(JSON.stringify({ error: 'Máximo de 500 menções por importação' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify candidate belongs to user
    const { data: candidate, error: candError } = await supabase
      .from('candidates')
      .select('id, user_id')
      .eq('id', candidate_id)
      .single();

    if (candError || !candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado ou sem acesso' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Analyze sentiment for mentions without it or if reanalyze requested
    const textsToAnalyze: { index: number; text: string }[] = [];
    for (let i = 0; i < mentions.length; i++) {
      const m = mentions[i];
      if (m.content && (reanalyze_sentiment || !m.sentiment)) {
        textsToAnalyze.push({ index: i, text: m.content });
      }
    }

    let sentimentMap: Map<number, SentimentResult> = new Map();
    if (textsToAnalyze.length > 0) {
      // Process in batches of 25
      const batchSize = 25;
      for (let b = 0; b < textsToAnalyze.length; b += batchSize) {
        const batch = textsToAnalyze.slice(b, b + batchSize);
        const results = await analyzeSentimentBatch(batch.map(t => t.text));
        if (results) {
          batch.forEach((item, idx) => {
            if (results[idx]) sentimentMap.set(item.index, results[idx]);
          });
        }
      }
    }

    // Track networks found
    const networksFound = new Set<string>();

    // Build insert records
    const records = mentions.map((m, i) => {
      const network = mapSourceToNetwork(m.source, m.sourceType);
      networksFound.add(network);

      let sentimentLabel: string | null = null;
      let sentimentScore: number | null = null;

      // Use AI sentiment if available
      const aiResult = sentimentMap.get(i);
      if (aiResult) {
        sentimentLabel = aiResult.label;
        sentimentScore = aiResult.score;
      } else if (m.sentiment) {
        // Fall back to Brand24's own sentiment
        const mapped = mapBrand24Sentiment(m.sentiment);
        sentimentLabel = mapped.label;
        sentimentScore = mapped.score;
      }

      return {
        user_id: user.id,
        candidate_id,
        comment_text: m.content || null,
        comment_author: m.author || null,
        author_profile_url: m.authorUrl || m.url || null,
        social_network: network,
        sentiment_label: sentimentLabel,
        sentiment_score: sentimentScore,
        likes_count: m.likes || 0,
        replies_count: m.comments || 0,
        shares_count: m.shares || 0,
        original_posted_at: m.date || null,
        collected_at: new Date().toISOString(),
        interaction_type: 'brand24_import',
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from('social_interactions')
      .insert(records)
      .select('id, social_network, sentiment_label');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Erro ao inserir menções', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Count by network
    const networkCounts: Record<string, number> = {};
    inserted?.forEach(r => {
      networkCounts[r.social_network] = (networkCounts[r.social_network] || 0) + 1;
    });

    // Count sentiments
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, none: 0 };
    inserted?.forEach(r => {
      if (r.sentiment_label === 'Positivo') sentimentCounts.positive++;
      else if (r.sentiment_label === 'Negativo') sentimentCounts.negative++;
      else if (r.sentiment_label === 'Neutro') sentimentCounts.neutral++;
      else sentimentCounts.none++;
    });

    return new Response(JSON.stringify({
      success: true,
      imported: inserted?.length || 0,
      networks: networkCounts,
      sentiment: sentimentCounts,
      ai_analyzed: sentimentMap.size,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
