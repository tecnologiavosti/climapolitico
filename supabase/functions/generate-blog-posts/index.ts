import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function slugify(s: string) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .slice(0, 80) + '-' + Math.random().toString(36).slice(2, 7);
}

async function callAI(theme: string, subtheme: string) {
  const prompt = `Você é uma especialista em produção de conteúdo SEO em português brasileiro.

Tema principal do site: ${theme}
${subtheme ? `Subtema: ${subtheme}` : ''}

Crie UM artigo original em português com:
- título atrativo
- resumo curto (1-2 frases)
- conteúdo detalhado em markdown, com subtítulos (##), parágrafos, tom profissional mas acolhedor, foco em SEO
- 3 a 5 tags relevantes

Retorne SOMENTE JSON válido no formato:
{"title":"...","excerpt":"...","content":"...","tags":["..."]}`;

  const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`AI gateway ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY ausente');
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const userClient = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: roleRow } = await supabase.from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
    if (!roleRow) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const body = await req.json().catch(() => ({}));
    const theme = (body.theme || '').toString().trim();
    const subtheme = (body.subtheme || '').toString().trim();
    const count = Math.min(Math.max(Number(body.count) || 1, 1), 5);
    if (!theme) return new Response(JSON.stringify({ error: 'theme is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const created: any[] = [];
    const errors: string[] = [];
    for (let i = 0; i < count; i++) {
      try {
        const post = await callAI(theme, subtheme);
        const title = (post.title || 'Sem título').toString();
        const row = {
          title,
          slug: slugify(title),
          excerpt: (post.excerpt || '').toString(),
          content: (post.content || '').toString(),
          tags: Array.isArray(post.tags) ? post.tags.map((t: any) => String(t)).slice(0, 8) : [],
          published: true,
          created_by: user.id,
        };
        const { data: inserted, error: insErr } = await supabase.from('blog_posts').insert(row).select().single();
        if (insErr) throw insErr;
        created.push(inserted);
      } catch (e: any) {
        errors.push(e.message || String(e));
      }
    }

    return new Response(JSON.stringify({ created, errors }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
