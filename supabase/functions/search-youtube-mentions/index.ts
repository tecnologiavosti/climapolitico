import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface YouTubeSearchResult {
  items: Array<{
    id: { videoId: string };
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
      channelTitle: string;
    };
  }>;
}

interface YouTubeCommentThread {
  items: Array<{
    id: string;
    snippet: {
      topLevelComment: {
        id: string;
        snippet: {
          textOriginal: string;
          textDisplay: string;
          authorDisplayName: string;
          authorChannelId?: { value: string };
          likeCount: number;
          publishedAt: string;
          videoId: string;
        };
      };
    };
  }>;
  nextPageToken?: string;
}

interface SentimentResult {
  label: 'Positivo' | 'Negativo' | 'Neutro';
  score: number;
}

async function analyzeSentiment(text: string): Promise<SentimentResult> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  
  if (!apiKey) {
    console.warn('LOVABLE_API_KEY not found, defaulting to neutral sentiment');
    return { label: 'Neutro', score: 0.5 };
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `Você é um analisador de sentimento político. Analise o texto e responda APENAS com um JSON no formato: {"label": "Positivo|Negativo|Neutro", "score": 0.0-1.0}
            
            Regras:
            - Positivo: Apoio, elogio, concordância, entusiasmo
            - Negativo: Crítica, desaprovação, raiva, decepção  
            - Neutro: Informativo, sem opinião clara, pergunta

            Score: 0 = muito negativo, 0.5 = neutro, 1 = muito positivo`
          },
          {
            role: 'user',
            content: text.substring(0, 500) // Limit text length
          }
        ],
        temperature: 0.1,
        max_tokens: 50
      })
    });

    if (!response.ok) {
      console.error('Sentiment API error:', response.status);
      return { label: 'Neutro', score: 0.5 };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Parse JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        label: parsed.label || 'Neutro',
        score: typeof parsed.score === 'number' ? parsed.score : 0.5
      };
    }

    return { label: 'Neutro', score: 0.5 };
  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return { label: 'Neutro', score: 0.5 };
  }
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function analyzeSentimentBatch(texts: string[]): Promise<SentimentResult[] | null> {
  const apiKey = Deno.env.get('LOVABLE_API_KEY');
  const requestId = crypto.randomUUID();

  // Nunca aplicar fallback fixo (Neutro/0.5) sem avisar: isso mascara bugs e invalida métricas.
  if (!apiKey) {
    console.error(`[SENTIMENT:${requestId}] LOVABLE_API_KEY ausente - sentimento indisponível`);
    return null;
  }

  // Safety: keep payload bounded and clean texts
  const clipped = texts.map((t) => (t || '').substring(0, 400).trim()).filter(t => t.length > 0);
  if (clipped.length === 0) return null;

  console.log(`[SENTIMENT:${requestId}] Entradas=${clipped.length} | Exemplo="${clipped[0].substring(0, 80)}..."`);

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

    // Format comments as numbered list for better model understanding
    const userContent = clipped.map((text, i) => `${i + 1}. "${text}"`).join('\n');

    // Retry simples para 429 (rate limit), sem mascarar o erro.
    const maxAttempts = 3;
    let lastStatus: number | undefined;
    let lastBody = '';
    let response: Response | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
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

      if (response.ok) break;

      lastStatus = response.status;
      lastBody = await response.text().catch(() => '');
      console.error(`[SENTIMENT:${requestId}] Gateway erro ${response.status} (tentativa ${attempt}/${maxAttempts}): ${lastBody.substring(0, 400)}`);

      if (response.status === 429 && attempt < maxAttempts) {
        const backoffMs = 1500 * attempt;
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }

      // 402 (créditos) e outros: não insistir.
      break;
    }

    if (!response || !response.ok) {
      console.error(`[SENTIMENT:${requestId}] Falha definitiva (status=${lastStatus ?? 'desconhecido'}). Sentimento NÃO será persistido.`);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    console.log(`[SENTIMENT:${requestId}] Saída bruta (500): ${content.substring(0, 500)}`);

    // Extract JSON array from response
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) {
      console.error(`[SENTIMENT:${requestId}] Sem JSON array na resposta; sentimento NÃO será persistido.`);
      console.log(`[SENTIMENT:${requestId}] Resposta completa:`, content);
      return null;
    }

    let parsed: any[];
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error(`[SENTIMENT:${requestId}] JSON parse error:`, parseError);
      console.log(`[SENTIMENT:${requestId}] Tentativa de parse:`, jsonMatch[0]);
      return null;
    }

    if (!Array.isArray(parsed)) {
      console.error(`[SENTIMENT:${requestId}] Parsed não é array; sentimento NÃO será persistido.`);
      return null;
    }

    // Log sentiment distribution for debugging
    const sentimentCounts = { Positivo: 0, Negativo: 0, Neutro: 0 };
    
    // Normalize (sem inventar Neutro/0.5 quando a IA não devolveu item)
    if (parsed.length < texts.length) {
      console.error(`[SENTIMENT:${requestId}] A IA retornou menos itens (${parsed.length}) que entradas (${texts.length}); descartando lote.`);
      return null;
    }

    const normalized: SentimentResult[] = texts.map((_, idx) => {
      const p = parsed[idx];
      const label = (p?.label === 'Positivo' || p?.label === 'Negativo' || p?.label === 'Neutro')
        ? (p.label as 'Positivo' | 'Negativo' | 'Neutro')
        : 'Neutro';
      const score = typeof p?.score === 'number' ? Math.max(0, Math.min(1, p.score)) : 0.5;

      sentimentCounts[label]++;
      return { label, score };
    });

    console.log(`[SENTIMENT:${requestId}] Distribuição: Positivo=${sentimentCounts.Positivo}, Negativo=${sentimentCounts.Negativo}, Neutro=${sentimentCounts.Neutro}`);
    
    // Log sample results for verification
    for (let i = 0; i < Math.min(3, normalized.length); i++) {
      console.log(`[SENTIMENT:${requestId}] "${clipped[i]?.substring(0, 70)}..." -> ${normalized[i].label} (${normalized[i].score})`);
    }

    return normalized;
  } catch (error) {
    console.error(`[SENTIMENT:${requestId}] Erro inesperado na análise:`, error);
    return null;
  }
}

async function searchYouTubeVideos(
  query: string, 
  apiKey: string, 
  maxResults: number = 10,
  orderBy: 'date' | 'relevance' | 'viewCount' = 'date'
): Promise<YouTubeSearchResult> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('order', orderBy); // Use date to get newest videos
  url.searchParams.set('relevanceLanguage', 'pt');
  url.searchParams.set('regionCode', 'BR');
  url.searchParams.set('key', apiKey);

  console.log(`Searching YouTube for: "${query}" (order: ${orderBy})`);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.text();
    console.error('YouTube Search API error:', error);
    throw new Error(`YouTube API error: ${response.status} - ${error}`);
  }

  return await response.json();
}

async function getVideoComments(
  videoId: string, 
  apiKey: string, 
  maxResults: number = 50,
  pageToken?: string
): Promise<YouTubeCommentThread> {
  const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('videoId', videoId);
  url.searchParams.set('maxResults', maxResults.toString());
  url.searchParams.set('order', 'relevance');
  url.searchParams.set('textFormat', 'plainText');
  url.searchParams.set('key', apiKey);
  
  if (pageToken) {
    url.searchParams.set('pageToken', pageToken);
  }

  console.log(`Fetching comments for video: ${videoId}`);
  
  const response = await fetch(url.toString());
  
  if (!response.ok) {
    const error = await response.text();
    // Comments might be disabled - return empty
    if (response.status === 403) {
      console.warn(`Comments disabled for video ${videoId}`);
      return { items: [] };
    }
    console.error('YouTube Comments API error:', error);
    throw new Error(`YouTube Comments API error: ${response.status}`);
  }

  return await response.json();
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Get auth header for user validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized - no auth token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Service client for auth validation (more reliable than anon for token introspection)
    const supabaseService = createClient(supabaseUrl, supabaseServiceRoleKey);
    
    // User-scoped client for DB ops (keeps RLS enforced)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Validate user — supports internal cron via service-role token
    const token = authHeader.replace('Bearer ', '');
    const requestBody = await req.json();
    const isInternalCronRequest = token === supabaseServiceRoleKey;

    let userId = '';
    if (isInternalCronRequest) {
      if (!requestBody?.userId) {
        return new Response(
          JSON.stringify({ error: 'userId obrigatório para execução interna' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      userId = requestBody.userId;
      console.log(`[YOUTUBE] Cron interno user=${userId}`);
    } else {
      const { data: userData, error: authError } = await supabaseService.auth.getUser(token);
      if (authError || !userData?.user) {
        console.error('Auth validation failed:', authError);
        return new Response(
          JSON.stringify({ error: 'Unauthorized - invalid token' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      userId = userData.user.id;
      console.log(`Authenticated user: ${userId}`);
    }

    // Get YouTube API key
    const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY');
    if (!youtubeApiKey) {
      return new Response(
        JSON.stringify({ error: 'YouTube API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body (already consumed above)
    const {
      candidateId,
      candidateName,
      candidateAliases = [] as string[],
      maxVideos = 25,
      maxCommentsPerVideo = 100,
      maxNewComments = 500,
    } = requestBody;

    if (!candidateId || !candidateName) {
      return new Response(
        JSON.stringify({ error: 'candidateId and candidateName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============================================================
    // SEMANTIC FILTER: Build list of keywords to match in comments
    // ============================================================
    // A comment is only valid if it explicitly mentions the candidate
    const buildCandidateKeywords = (name: string, aliases: string[]): string[] => {
      const keywords: string[] = [];
      
      // Add full name
      keywords.push(name.toLowerCase().trim());
      
      // Split name into parts (first name, last name, etc.)
      const nameParts = name.split(/\s+/).filter(part => part.length >= 3);
      for (const part of nameParts) {
        keywords.push(part.toLowerCase().trim());
      }
      
      // Add configured aliases
      for (const alias of aliases) {
        if (alias && alias.trim().length >= 2) {
          keywords.push(alias.toLowerCase().trim());
        }
      }
      
      // Remove duplicates
      return [...new Set(keywords)];
    };

    const candidateKeywords = buildCandidateKeywords(candidateName, candidateAliases);
    console.log(`Semantic filter keywords for "${candidateName}":`, candidateKeywords);

    // Function to check if a comment mentions the candidate
    const commentMentionsCandidate = (commentText: string): boolean => {
      if (!commentText) return false;
      const lowerText = commentText.toLowerCase();
      
      // Check if any keyword is found in the comment
      for (const keyword of candidateKeywords) {
        // Use word boundary check to avoid partial matches
        // e.g., "bolso" shouldn't match but "bolsonaro" should
        const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(lowerText)) {
          return true;
        }
      }
      return false;
    };

    console.log(`Starting YouTube collection for candidate: ${candidateName} (${candidateId})`);

    // Get already collected comment authors to avoid duplicates
    // Fetch ALL existing comments with pagination to bypass 1000-row limit
    let allExistingComments: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await supabase
        .from('social_interactions')
        .select('comment_text, comment_author, original_posted_at')
        .eq('candidate_id', candidateId)
        .eq('social_network', 'YouTube')
        .range(offset, offset + pageSize - 1);

      if (pageError) {
        console.error('Error fetching existing comments page:', pageError);
        break;
      }

      if (!page || page.length === 0) break;

      allExistingComments = [...allExistingComments, ...page];

      if (page.length < pageSize) break; // Last page
      offset += pageSize;
    }

    // Create a Set of unique identifiers for existing comments
    const existingCommentsSet = new Set(
      allExistingComments.map(c => 
        `${c.comment_author}:${c.original_posted_at}:${(c.comment_text || '').substring(0, 50)}`
      )
    );
    
    console.log(`Found ${existingCommentsSet.size} existing comments to skip duplicates`);

    // Search for videos - use 'date' to get newest videos first
    const searchResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'date');
    
    // Also search by relevance to get popular videos
    const relevanceResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'relevance');
    
    // Also search by viewCount to get most viewed videos
    const viewCountResults = await searchYouTubeVideos(candidateName, youtubeApiKey, maxVideos, 'viewCount');
    
    // Merge and deduplicate video results
    const allVideoIds = new Set<string>();
    const allVideos: YouTubeSearchResult['items'] = [];
    
    for (const video of [...(searchResults.items || []), ...(relevanceResults.items || []), ...(viewCountResults.items || [])]) {
      if (!allVideoIds.has(video.id.videoId)) {
        allVideoIds.add(video.id.videoId);
        allVideos.push(video);
      }
    }
    
    const videosFound = allVideos.length;
    console.log(`Found ${videosFound} unique videos (date + relevance + viewCount search)`);

    if (videosFound === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No videos found for this candidate',
          stats: { videosFound: 0, commentsCollected: 0, sentimentAnalyzed: 0, skippedDuplicates: 0 }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Collect comments from each video
    let totalComments = 0; // new comments inserted
    let skippedDuplicates = 0;
    let filteredOutComments = 0; // comments that don't mention the candidate
    let sentimentAnalyzed = 0;
    let sentimentNotAnalyzed = 0;
    const uniqueAuthors = new Set<string>();

    // Increased batch size for faster processing
    const BATCH_SIZE = 15;
    const nowIso = new Date().toISOString();
    const insertedRowsForStats: any[] = [];

    const insertBatch = async (batchItems: any[]) => {
      if (batchItems.length === 0) return;
      console.log(`Inserting batch: ${batchItems.length} comments`);
      const { error: insertError } = await supabase
        .from('social_interactions')
        .insert(batchItems);
      if (insertError) {
        console.error('Database insert error (batch):', insertError);
        // Partial success strategy: don't throw; let the run finish and return stats.
      }
      insertedRowsForStats.push(...batchItems);
    };

    for (const video of allVideos) {
      if (totalComments >= maxNewComments) break;

      const videoId = video.id.videoId;
      let pageToken: string | undefined = undefined;

      try {
        while (totalComments < maxNewComments) {
          const commentsData = await getVideoComments(videoId, youtubeApiKey, maxCommentsPerVideo, pageToken);
          const items = commentsData.items || [];
          if (items.length === 0) break;

          // Collect new comments for this page
          const pageCandidates: {
            commentText: string;
            author: string;
            authorChannelId?: string;
            likeCount: number;
            publishedAt: string;
          }[] = [];

          for (const thread of items) {
            if (totalComments + pageCandidates.length >= maxNewComments) break;
            const comment = thread.snippet.topLevelComment.snippet;
            const text = (comment.textOriginal || '').trim();
            if (!text) continue;

            // ============================================================
            // SEMANTIC FILTER: Only accept comments that mention the candidate
            // ============================================================
            if (!commentMentionsCandidate(text)) {
              filteredOutComments++;
              continue;
            }

            // Create unique identifier for this comment (compatible with existing stored signature)
            const commentKey = `${comment.authorDisplayName}:${comment.publishedAt}:${text.substring(0, 50)}`;

            if (existingCommentsSet.has(commentKey)) {
              skippedDuplicates++;
              continue;
            }

            // Mark as seen immediately so we don't duplicate inside the same run
            existingCommentsSet.add(commentKey);

            uniqueAuthors.add(comment.authorDisplayName);

            pageCandidates.push({
              commentText: text,
              author: comment.authorDisplayName,
              authorChannelId: comment.authorChannelId?.value,
              likeCount: comment.likeCount || 0,
              publishedAt: comment.publishedAt,
            });
          }

          // Batch sentiment analysis to avoid 429 + speed up
          for (const chunk of chunkArray(pageCandidates, BATCH_SIZE)) {
            if (chunk.length === 0) continue;
            const sentiments = await analyzeSentimentBatch(chunk.map((c) => c.commentText));
            const didAnalyze = Array.isArray(sentiments);
            if (didAnalyze) sentimentAnalyzed += chunk.length;
            else sentimentNotAnalyzed += chunk.length;

            const batchToInsert = chunk.map((c, idx) => {
              const s = didAnalyze ? (sentiments![idx] as SentimentResult | undefined) : undefined;
              const finalLabel = s?.label ?? null;
              const finalScore = typeof s?.score === 'number' ? s.score : null;

              if (idx < 3) {
                console.log(`[SENTIMENT:PERSIST] texto="${c.commentText.substring(0, 80)}..." | label=${finalLabel ?? 'NULL'} | score=${finalScore ?? 'NULL'}`);
              }

              return {
                user_id: userId,
                candidate_id: candidateId,
                comment_text: c.commentText.substring(0, 5000),
                comment_author: c.author,
                author_profile_url: c.authorChannelId ? `https://www.youtube.com/channel/${c.authorChannelId}` : null,
                social_network: 'YouTube',
                interaction_type: 'comment',
                sentiment_label: finalLabel,
                sentiment_score: finalScore,
                likes_count: c.likeCount,
                replies_count: 0,
                shares_count: 0,
                original_posted_at: c.publishedAt,
                collected_at: nowIso,
              };
            });

            await insertBatch(batchToInsert);
            totalComments += chunk.length;

            // Throttle para reduzir 429 (rate limit) e evitar que o sistema grave "Neutro" por falha de IA.
            await new Promise((r) => setTimeout(r, 350));

            if (totalComments >= maxNewComments) break;
          }

          pageToken = commentsData.nextPageToken;
          if (!pageToken) break;
        }
      } catch (videoError) {
        console.error(`Error processing video ${videoId}:`, videoError);
      }
    }
    
    console.log(`Filtered out ${filteredOutComments} comments that don't mention the candidate`);
    console.log(`Skipped ${skippedDuplicates} duplicate comments`);
    console.log(`Found ${totalComments} new relevant comments to insert`);

    // Calculate sentiment distribution (sem contar NULL como Neutro)
    const sentimentCounts = insertedRowsForStats.reduce(
      (acc, item) => {
        const label = item.sentiment_label;
        if (label === 'Positivo' || label === 'Negativo' || label === 'Neutro') {
          acc[label] = (acc[label] || 0) + 1;
        } else {
          acc.__nao_analisado = (acc.__nao_analisado || 0) + 1;
        }
        return acc;
      },
      { Positivo: 0, Negativo: 0, Neutro: 0, __nao_analisado: 0 } as Record<string, number>
    );

    const totalLikes = insertedRowsForStats.reduce((sum, item) => sum + (item.likes_count || 0), 0);

    // Recalculate metrics cache for this candidate (single source of truth)
    console.log('Triggering metrics recalculation...');
    try {
      const metricsResponse = await fetch(
        `${supabaseUrl}/functions/v1/recalculate-candidate-metrics`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': authHeader,
          },
          body: JSON.stringify({ candidateId }),
        }
      );
      
      if (!metricsResponse.ok) {
        console.warn('Metrics recalculation returned non-OK:', await metricsResponse.text());
      } else {
        console.log('Metrics recalculated successfully');
      }
    } catch (metricsError) {
      console.warn('Failed to recalculate metrics (non-blocking):', metricsError);
    }

    // Get total count after insertion (from cache or direct count)
    const { count: totalCount } = await supabase
      .from('social_interactions')
      .select('*', { count: 'exact', head: true })
      .eq('candidate_id', candidateId)
      .eq('user_id', userId);

    const stats = {
      videosFound,
      newCommentsCollected: totalComments,
      filteredOutNotMentioningCandidate: filteredOutComments,
      skippedDuplicates,
      sentimentAnalyzed,
      sentimentNotAnalyzed,
      uniqueAuthors: uniqueAuthors.size,
      totalEngagement: totalLikes,
      sentimentDistribution: {
        Positivo: sentimentCounts.Positivo || 0,
        Negativo: sentimentCounts.Negativo || 0,
        Neutro: sentimentCounts.Neutro || 0,
      },
      sentimentNaoAnalisado: sentimentCounts.__nao_analisado || 0,
      totalCommentsInDatabase: (totalCount || 0),
      filterKeywordsUsed: candidateKeywords,
    };

    console.log('Collection complete:', stats);

    return new Response(
      JSON.stringify({
        success: true,
        message: totalComments > 0 
          ? `Collected ${totalComments} relevant comments (filtered ${filteredOutComments} off-topic, skipped ${skippedDuplicates} duplicates). Total in database: ${totalCount}`
          : `No new relevant comments found (filtered ${filteredOutComments} off-topic, ${skippedDuplicates} duplicates skipped). Total in database: ${totalCount}`,
        stats
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('YouTube collection error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    const normalized = errorMessage.toLowerCase();
    const isQuotaExceeded = normalized.includes('quotaexceeded') || normalized.includes('exceeded your') || normalized.includes('youtube api error: 403');
    const isYouTubeApiFailure = normalized.includes('youtube api error') || normalized.includes('youtube comments api error') || normalized.includes('quota');

    if (isQuotaExceeded || isYouTubeApiFailure) {
      return new Response(
        JSON.stringify({
          success: false,
          fallback: true,
          error: isQuotaExceeded ? 'YOUTUBE_QUOTA_EXCEEDED' : 'YOUTUBE_API_ERROR',
          message: isQuotaExceeded
            ? 'A cota diária da API do YouTube foi excedida. Tente novamente amanhã ou use outras fontes.'
            : 'O YouTube falhou temporariamente. Use outras fontes enquanto esse provedor se recupera.',
          inserted: 0,
          videosFound: 0,
          stats: {
            newCommentsCollected: 0,
            commentsCollected: 0,
            skippedDuplicates: 0,
            totalCommentsInDatabase: 0,
          },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        fallback: true,
        error: 'SERVICE_FAILED',
        message: 'A coleta do YouTube falhou temporariamente.',
        inserted: 0,
        videosFound: 0,
        stats: {
          newCommentsCollected: 0,
          commentsCollected: 0,
          skippedDuplicates: 0,
          totalCommentsInDatabase: 0,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
