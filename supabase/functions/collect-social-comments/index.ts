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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Check authentication method
    const authHeader = req.headers.get('Authorization');
    const webhookSecretHeader = req.headers.get('x-webhook-secret');
    
    let userId: string | null = null;
    let isWebhook = false;
    
    // Method 1: Webhook with secret key (for external services)
    if (webhookSecretHeader && webhookSecret && webhookSecretHeader === webhookSecret) {
      isWebhook = true;
      console.log('Authenticated via webhook secret');
    }
    // Method 2: JWT authentication (for logged-in users)
    else if (authHeader) {
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
    }
    else {
      return new Response(
        JSON.stringify({ error: 'Autenticação necessária' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json();
    const { comments, user_id: providedUserId } = body as { 
      comments: SocialComment[]; 
      user_id?: string;
    };

    if (!comments || !Array.isArray(comments) || comments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Array de comentários é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit batch size
    if (comments.length > 100) {
      return new Response(
        JSON.stringify({ error: 'Máximo de 100 comentários por requisição' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Determine user_id
    const effectiveUserId = userId || providedUserId;
    
    if (!effectiveUserId) {
      return new Response(
        JSON.stringify({ error: 'user_id é obrigatório para webhooks' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate and prepare comments
    const validComments: any[] = [];
    const errors: string[] = [];

    for (let i = 0; i < comments.length; i++) {
      const comment = comments[i];
      
      // Validate required fields
      if (!comment.candidate_id) {
        errors.push(`Comentário ${i + 1}: candidate_id é obrigatório`);
        continue;
      }
      if (!comment.social_network) {
        errors.push(`Comentário ${i + 1}: social_network é obrigatório`);
        continue;
      }

      // Validate candidate exists and belongs to user
      const { data: candidate, error: candError } = await supabase
        .from('candidates')
        .select('id, user_id')
        .eq('id', comment.candidate_id)
        .single();

      if (candError || !candidate) {
        errors.push(`Comentário ${i + 1}: candidato não encontrado`);
        continue;
      }

      // For non-webhook, verify ownership
      if (!isWebhook && candidate.user_id !== effectiveUserId) {
        errors.push(`Comentário ${i + 1}: você não tem acesso a este candidato`);
        continue;
      }

      validComments.push({
        user_id: candidate.user_id,
        candidate_id: comment.candidate_id,
        comment_text: comment.comment_text || null,
        comment_author: comment.comment_author || null,
        author_profile_url: comment.author_profile_url || null,
        social_network: comment.social_network.toLowerCase(),
        sentiment_label: comment.sentiment_label || null,
        sentiment_score: comment.sentiment_score || null,
        likes_count: comment.likes_count || 0,
        replies_count: comment.replies_count || 0,
        shares_count: comment.shares_count || 0,
        original_posted_at: comment.original_posted_at || null,
        collected_at: new Date().toISOString(),
        interaction_type: 'comment',
      });
    }

    if (validComments.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Nenhum comentário válido para inserir', 
          details: errors 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert comments
    const { data: inserted, error: insertError } = await supabase
      .from('social_interactions')
      .insert(validComments)
      .select('id, candidate_id, social_network, sentiment_label');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(
        JSON.stringify({ error: 'Erro ao inserir comentários', details: insertError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Successfully inserted ${inserted?.length || 0} comments`);

    return new Response(
      JSON.stringify({
        success: true,
        inserted: inserted?.length || 0,
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
