import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { cleanContent } from "../_shared/clean-content.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RSSMention {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  source: string;
}

interface SentimentResult {
  label: string;
  score: number;
}

function parseRSSFeed(xmlText: string): RSSMention[] {
  const items: RSSMention[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xmlText)) !== null) {
    const xml = match[1];
    const title = xml.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
    const link = xml.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const desc = xml.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/)?.[1] || '';
    const pubDate = xml.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
    const source = xml.match(/<source.*?>(.*?)<\/source>/)?.[1] || '';

    const cleanDesc = cleanContent(desc);
    const cleanTitle = cleanContent(title);

    if (cleanTitle || cleanDesc) {
      items.push({
        title: cleanTitle,
        link,
        description: cleanDesc.substring(0, 1000),
        pubDate,
        source: cleanContent(source) || extractDomainFromUrl(link),
      });
    }
  }
  return items;
}

function extractDomainFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace('www.', '');
  } catch {
    return 'unknown';
  }
}

function detectNetwork(source: string, link: string): string {
  const s = (source + ' ' + link).toLowerCase();
  if (s.includes('twitter.com') || s.includes('x.com')) return 'twitter';
  if (s.includes('facebook.com') || s.includes('fb.com')) return 'facebook';
  if (s.includes('instagram.com')) return 'instagram';
  if (s.includes('youtube.com') || s.includes('youtu.be')) return 'youtube';
  if (s.includes('tiktok.com')) return 'tiktok';
  if (s.includes('reddit.com')) return 'reddit';
  if (s.includes('linkedin.com')) return 'linkedin';
  if (s.includes('tumblr.com')) return 'tumblr';
  if (s.includes('pinterest.com')) return 'pinterest';
  // News/blogs/forums
  return 'web';
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
            content: `Você é um especialista em análise de sentimento político brasileiro. Classifique cada texto como Positivo (0.7-1.0), Negativo (0.0-0.3) ou Neutro (0.4-0.6). Responda APENAS com JSON array.`
          },
          {
            role: 'user',
            content: `Analise:\n${texts.map((t, i) => `${i + 1}. "${t.substring(0, 300)}"`).join('\n')}\n\nRetorne: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0}]`
          }
        ],
        temperature: 0.1,
        max_tokens: texts.length * 50 + 100,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return null;
    const results: SentimentResult[] = JSON.parse(jsonMatch[0]);
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

    // Auth
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
    const { rss_url, candidate_id } = body as { rss_url: string; candidate_id: string };

    if (!rss_url || !candidate_id) {
      return new Response(JSON.stringify({ error: 'rss_url e candidate_id são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Verify candidate ownership
    const { data: candidate, error: candError } = await supabase
      .from('candidates')
      .select('id, user_id, full_name')
      .eq('id', candidate_id)
      .single();

    if (candError || !candidate || candidate.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Candidato não encontrado' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`Fetching Brand24 RSS for "${candidate.full_name}": ${rss_url}`);

    // Fetch RSS feed
    const rssResponse = await fetch(rss_url, {
      headers: { 'User-Agent': 'ClimaPolitico/1.0' },
    });

    if (!rssResponse.ok) {
      return new Response(JSON.stringify({ error: `Erro ao acessar RSS: ${rssResponse.status}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const xmlText = await rssResponse.text();
    const mentions = parseRSSFeed(xmlText);
    console.log(`Parsed ${mentions.length} mentions from RSS`);

    if (mentions.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, imported: 0, skipped: 0, networks: {}, message: 'Nenhuma menção no feed RSS' 
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Check for duplicates - use link as unique identifier
    const links = mentions.map(m => m.link).filter(Boolean);
    const { data: existing } = await supabase
      .from('social_interactions')
      .select('author_profile_url')
      .eq('candidate_id', candidate_id)
      .eq('interaction_type', 'brand24_rss')
      .in('author_profile_url', links.slice(0, 100));

    const existingLinks = new Set((existing || []).map(e => e.author_profile_url));
    const newMentions = mentions.filter(m => !existingLinks.has(m.link));
    const skipped = mentions.length - newMentions.length;

    console.log(`New: ${newMentions.length}, Skipped (duplicates): ${skipped}`);

    if (newMentions.length === 0) {
      return new Response(JSON.stringify({
        success: true, imported: 0, skipped, networks: {}, message: 'Todas as menções já foram coletadas'
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Analyze sentiment in batches
    const textsToAnalyze = newMentions.map(m => `${m.title} ${m.description}`.trim());
    const sentimentMap = new Map<number, SentimentResult>();
    const batchSize = 25;

    for (let i = 0; i < textsToAnalyze.length; i += batchSize) {
      const batch = textsToAnalyze.slice(i, i + batchSize);
      const results = await analyzeSentimentBatch(batch);
      if (results) {
        results.forEach((r, idx) => sentimentMap.set(i + idx, r));
      }
    }

    // Track networks
    const networkCounts: Record<string, number> = {};

    // Build records
    const records = newMentions.map((m, i) => {
      const network = detectNetwork(m.source, m.link);
      networkCounts[network] = (networkCounts[network] || 0) + 1;

      const sentiment = sentimentMap.get(i);

      return {
        user_id: user.id,
        candidate_id,
        comment_text: `${m.title}\n\n${m.description}`.trim().substring(0, 5000),
        comment_author: m.source || null,
        author_profile_url: m.link || null,
        social_network: network,
        sentiment_label: sentiment?.label || null,
        sentiment_score: sentiment?.score || null,
        likes_count: 0,
        replies_count: 0,
        shares_count: 0,
        original_posted_at: m.pubDate ? new Date(m.pubDate).toISOString() : null,
        collected_at: new Date().toISOString(),
        interaction_type: 'brand24_rss',
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from('social_interactions')
      .insert(records)
      .select('id, social_network, sentiment_label');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ error: 'Erro ao salvar menções', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Count sentiments
    const sentimentCounts = { positive: 0, negative: 0, neutral: 0, none: 0 };
    inserted?.forEach(r => {
      if (r.sentiment_label === 'Positivo') sentimentCounts.positive++;
      else if (r.sentiment_label === 'Negativo') sentimentCounts.negative++;
      else if (r.sentiment_label === 'Neutro') sentimentCounts.neutral++;
      else sentimentCounts.none++;
    });

    console.log(`Imported ${inserted?.length || 0} mentions. Networks: ${JSON.stringify(networkCounts)}`);

    return new Response(JSON.stringify({
      success: true,
      imported: inserted?.length || 0,
      skipped,
      networks: networkCounts,
      sentiment: sentimentCounts,
      ai_analyzed: sentimentMap.size,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error: unknown) {
    console.error('Error:', error);
    const msg = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(JSON.stringify({ error: 'Erro interno', details: msg }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
