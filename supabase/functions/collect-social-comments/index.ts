import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
};

interface SocialComment {
  candidate_id: string;
  comment_text: string;
  comment_author?: string;
  author_profile_url?: string;
  social_network: string;
  sentiment_label?: string;
  sentiment_score?: number;
  likes_count?: number;
  replies_count?: number;
  shares_count?: number;
  original_posted_at?: string;
}

interface SentimentResult {
  label: string;
  score: number;
}

async function analyzeSentiment(comments: string[]): Promise<SentimentResult[]> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  if (!LOVABLE_API_KEY || comments.length === 0) {
    return comments.map(() => ({ label: 'Neutro', score: 0.5 }));
  }

  try {
    const prompt = `Analise o sentimento de cada comentário abaixo sobre candidatos políticos.
Para cada comentário, retorne APENAS um JSON array com objetos contendo "label" (Positivo, Negativo ou Neutro) e "score" (0 a 1, onde 0 é muito negativo e 1 é muito positivo).

Comentários:
${comments.map((c, i) => `${i + 1}. "${c}"`).join('\n')}

Retorne APENAS o JSON array, sem explicações:`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'Você é um analisador de sentimento especializado em comentários políticos em português brasileiro. Responda apenas com JSON válido.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error('AI Gateway error:', response.status);
      return comments.map(() => ({ label: 'Neutro', score: 0.5 }));
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('No JSON array found in response:', content);
      return comments.map(() => ({ label: 'Neutro', score: 0.5 }));
    }

    const results: SentimentResult[] = JSON.parse(jsonMatch[0]);
    
    // Validate and normalize results
    return comments.map((_, i) => {
      const result = results[i];
      if (!result || !result.label) {
        return { label: 'Neutro', score: 0.5 };
      }
      return {
        label: ['Positivo', 'Negativo', 'Neutro'].includes(result.label) ? result.label : 'Neutro',
        score: typeof result.score === 'number' ? Math.max(0, Math.min(1, result.score)) : 0.5,
      };
    });

  } catch (error) {
    console.error('Sentiment analysis error:', error);
    return comments.map(() => ({ label: 'Neutro', score: 0.5 }));
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const authHeader = req.headers.get('Authorization');
    const webhookSecretHeader = req.headers.get('x-webhook-secret');
    
    let userId: string | null = null;
    let isWebhook = false;
    
    if (webhookSecretHeader && webhookSecret && webhookSecretHeader === webhookSecret) {
      isWebhook = true;
      console.log('Authenticated via webhook secret');
    } else if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      
      if (authError || !user) {
        console.error('Auth error:', authError?.message);
        return new Response(
          JSON.stringify({ error: 'Não autorizado' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      userId = user.id;
      console.log('Authenticated via JWT for user:', userId);
    } else {
      return new Response(
        JSON.stringify({ error: 'Autenticação necessária' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { comments, user_id: providedUserId, auto_analyze = true } = body as { 
      comments: SocialComment[]; 
      user_id?: string;
      auto_analyze?: boolean;
    };

    if (!comments || !Array.isArray(comments) || comments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Array de comentários é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (comments.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Máximo de 100 comentários por requisição' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const effectiveUserId = userId || providedUserId;
    
    if (!effectiveUserId) {
      return new Response(
        JSON.stringify({ error: 'user_id é obrigatório para webhooks' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate comments
    const validComments: { comment: SocialComment; candidateUserId: string }[] = [];
    const errors: string[] = [];

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      
      if (!comment.candidate_id) {
        errors.push(`Comentário ${i + 1}: candidate_id é obrigatório`);
        continue;
      }
      if (!comment.social_network) {
        errors.push(`Comentário ${i + 1}: social_network é obrigatório`);
        continue;
      }

      const { data: candidate, error: candError } = await supabase
        .from('candidates')
        .select('id, user_id')
        .eq('id', comment.candidate_id)
        .single();

      if (candError || !candidate) {
        errors.push(`Comentário ${i + 1}: candidato não encontrado`);
        continue;
      }

      if (!isWebhook && candidate.user_id !== effectiveUserId) {
        errors.push(`Comentário ${i + 1}: você não tem acesso a este candidato`);
        continue;
      }

      validComments.push({ comment, candidateUserId: candidate.user_id });
    }

    if (validComments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Nenhum comentário válido para inserir', details: errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auto-analyze sentiment if enabled and comments have text
    let sentimentResults: SentimentResult[] = [];
    const textsToAnalyze = validComments
      .map(vc => vc.comment.comment_text)
      .filter((text): text is string => !!text && text.trim().length > 0);

    if (auto_analyze && textsToAnalyze.length > 0) {
      console.log(`Analyzing sentiment for ${textsToAnalyze.length} comments...`);
      sentimentResults = await analyzeSentiment(textsToAnalyze);
      console.log('Sentiment analysis complete');
    }

    // Build insert records with sentiment
    let sentimentIndex = 0;
    const insertRecords = validComments.map(({ comment, candidateUserId }) => {
      let sentiment_label = comment.sentiment_label || null;
      let sentiment_score = comment.sentiment_score || null;

      // Apply auto-analyzed sentiment if text exists and no manual sentiment provided
      if (auto_analyze && comment.comment_text && !comment.sentiment_label) {
        const result = sentimentResults[sentimentIndex];
        if (result) {
          sentiment_label = result.label;
          sentiment_score = result.score;
        }
        sentimentIndex++;
      }

      return {
        user_id: candidateUserId,
        candidate_id: comment.candidate_id,
        comment_text: comment.comment_text || null,
        comment_author: comment.comment_author || null,
        author_profile_url: comment.author_profile_url || null,
        social_network: comment.social_network.toLowerCase(),
        sentiment_label,
        sentiment_score,
        likes_count: comment.likes_count || 0,
        replies_count: comment.replies_count || 0,
        shares_count: comment.shares_count || 0,
        original_posted_at: comment.original_posted_at || null,
        collected_at: new Date().toISOString(),
        interaction_type: 'comment',
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from('social_interactions')
      .insert(insertRecords)
      .select('id, candidate_id, social_network, sentiment_label, sentiment_score');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Erro ao inserir comentários', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const analyzedCount = sentimentResults.length;
    console.log(`Inserted ${inserted?.length || 0} comments, ${analyzedCount} with auto-sentiment`);

    return new Response(
      JSON.stringify({
        success: true,
        inserted: inserted?.length || 0,
        analyzed: analyzedCount,
        skipped: errors.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Unexpected error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
