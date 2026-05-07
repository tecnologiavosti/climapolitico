// Edge function: refina sentimento via IA dos últimos comentários classificados pela heurística.
// Roda a cada 5 minutos via cron. Pequenos lotes para respeitar rate limits do gateway.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SentimentResult {
  label: "Positivo" | "Negativo" | "Neutro";
  score: number;
}

const NEG_REGEX =
  /(ladr[ãa]o|corrupt[oa]|mentiros[oa]|vagabund[oa]|bandido|cadeia|pris[ãa]o|fora\s|jamais|nunca\s|safad[oa]|canalha|absurdo|verg[oa]nha|nojo|nojent[oa]|p[ée]ssim[oa]|horr[íi]vel|odi[oa]|destru|fracass|incompetente|idiota|burr[oa]|imbecil|lixo|merda|fdp|pal(h|h)a[çc]o|farsante|traidor|gen[oa]cida|pat[ée]tico|rid[íi]culo|escr[óo]ria|gado|mortadela|petralha|bolsominion|coxinha|miser[áa]vel|🤮|👎|😡|💩|🤡|🙄|😒)/i;
const POS_REGEX =
  /(parab[ée]ns|melhor|[óo]tim[oa]|excelente|maravilhos[oa]|perfeit[oa]|mito|her[óo]i|orgulho|apoio|votarei|voto\s+em|t[ée]\s+amo|amo\s+voc|presidente\s+(lula|bolsonaro|caiado)|for[çc]a|estamos\s+(juntos|com)|vai\s+ganhar|vencer|vit[óo]ria|sucesso|deus\s+aben|verdadeiro|honest[oa]|competente|trabalhador|admiro|respeito|legenda|melhor\s+(presidente|governador|prefeito)|faz\s+o\s+l|mitou|❤️|👏|🙏|✊|🇧🇷|💚|💛|🥰|😍|👍|🔥)/i;

function heuristic(text: string): SentimentResult {
  const t = text || "";
  const neg = NEG_REGEX.test(t);
  const pos = POS_REGEX.test(t);
  if (neg && !pos) return { label: "Negativo", score: 0.2 };
  if (pos && !neg) return { label: "Positivo", score: 0.8 };
  if (neg && pos) return { label: "Negativo", score: 0.35 }; // ambivalente tende a crítica
  return { label: "Neutro", score: 0.5 };
}

// === Circuit breaker em memória (vive enquanto o worker estiver aquecido) ===
const providerCooldown: Record<string, number> = { cerebras: 0, groq: 0, gemini: 0 };
const isOnCooldown = (n: string) => Date.now() < (providerCooldown[n] || 0);
const setCooldown = (n: string, minutes: number) => {
  providerCooldown[n] = Date.now() + minutes * 60_000;
  console.warn(`[REFINE] ${n} cooldown ${minutes}min`);
};

async function callCerebras(texts: string[], cerebrasKey: string): Promise<SentimentResult[] | null> {
  if (isOnCooldown('cerebras')) { console.log('[REFINE] cerebras em cooldown'); return null; }
  const clipped = texts.map((t) => (t || "").substring(0, 400).trim());
  const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join("\n");

  const systemPrompt = `Você é especialista brasileiro em análise de sentimento político eleitoral.
REGRA CRÍTICA: "Neutro" é EXCEÇÃO, não regra. Use Neutro APENAS para: notícia 100% factual sem adjetivo, pergunta genuína sem viés, ou texto incompreensível. Em QUALQUER outro caso, escolha Positivo ou Negativo (mesmo com baixa confiança 0.55-0.65).
POSITIVO: apoio, elogio, defesa, torcida, "mito", "melhor", "verdadeiro", emojis ❤️👏🙏🔥👍, gírias "mitou"/"faz o L"/"presidente".
NEGATIVO: crítica, sarcasmo (MUITO comum em política BR — quase sempre negativo), xingamento, ironia, descrédito, "ladrão", "fora", "pal(h)aço", "vagabundo", emojis 🤮👎🤡🙄💩, gírias "gado"/"mortadela"/"petralha"/"bolsominion"/"coxinha".
Sarcasmo, ironia e dúvida cínica = NEGATIVO. Comentário curto com emoji negativo = NEGATIVO. Em empate genuíno, escolha NEGATIVO (política BR é polarizada e majoritariamente crítica).
Responda APENAS JSON object com chave "results" contendo array na MESMA ordem: {"results":[{"label":"Positivo|Negativo|Neutro","score":0.0-1.0},...]}`;

  // gpt-oss-120b e qwen-3-235b são preview/pago e podem dar 404 no free tier; llama3.1-8b é garantido.
  const models = ["llama3.1-8b", "qwen-3-235b-a22b-instruct-2507", "gpt-oss-120b"];
  for (const model of models) {
    try {
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${cerebrasKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.1,
          max_tokens: clipped.length * 50 + 200,
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn(`[REFINE] Cerebras ${model} ${res.status}: ${errBody.substring(0, 300)}`);
        if (res.status === 429) { setCooldown('cerebras', 10); return null; }
        continue;
      }
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      let parsed: any;
      try {
        parsed = JSON.parse(content);
      } catch {
        const m = content.match(/\[[\s\S]*\]/);
        if (!m) continue;
        parsed = JSON.parse(m[0]);
      }
      const arr = Array.isArray(parsed) ? parsed : (parsed.results || parsed.data || parsed.sentiments);
      if (!Array.isArray(arr) || arr.length < texts.length) continue;
      console.log(`[REFINE] Cerebras ${model} OK (${arr.length} resultados)`);
      return texts.map((_, i) => {
        const p = arr[i];
        const label =
          p?.label === "Positivo" || p?.label === "Negativo" || p?.label === "Neutro"
            ? p.label : "Neutro";
        const score = typeof p?.score === "number" ? Math.max(0, Math.min(1, p.score)) : 0.5;
        return { label, score };
      });
    } catch (e) {
      console.warn(`[REFINE] Cerebras ${model} exceção:`, e);
    }
  }
  return null;
}

async function callGroq(texts: string[], groqKey: string): Promise<SentimentResult[] | null> {
  if (isOnCooldown('groq')) { console.log('[REFINE] groq em cooldown'); return null; }
  const clipped = texts.map((t) => (t || "").substring(0, 400).trim());
  const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join("\n");

  const systemPrompt = `Você é analista político brasileiro especialista em sentimento eleitoral.
REGRA CRÍTICA: minimize "Neutro". Use Neutro APENAS em notícia factual pura, pergunta sem viés, ou texto sem sentido. Em qualquer outro caso classifique Positivo ou Negativo (mesmo com 0.55 de confiança).
POSITIVO: apoio, elogio, "mito", "melhor", emojis ❤️👏🔥👍🙏.
NEGATIVO: crítica, sarcasmo, ironia, xingamento, "ladrão", "fora", "palhaço", emojis 🤮👎🤡🙄. Gírias: "gado"/"mortadela"/"petralha"/"bolsominion"/"coxinha"=negativo; "mitou"/"faz o L"=positivo.
Sarcasmo/ironia = sempre NEGATIVO. Em empate, escolha NEGATIVO (política BR é polarizada).
Responda APENAS JSON array na mesma ordem: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0},...]`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: clipped.length * 40 + 100,
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      console.warn(`[REFINE] Groq ${res.status}`);
      if (res.status === 429) setCooldown('groq', 10);
      return null;
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    const m = content.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed) || parsed.length < texts.length) return null;
    return texts.map((_, i) => {
      const p = parsed[i];
      const label =
        p?.label === "Positivo" || p?.label === "Negativo" || p?.label === "Neutro"
          ? p.label : "Neutro";
      const score = typeof p?.score === "number" ? Math.max(0, Math.min(1, p.score)) : 0.5;
      return { label, score };
    });
  } catch (e) {
    console.warn("[REFINE] Groq exceção:", e);
    return null;
  }
}

async function callAI(texts: string[], apiKey: string): Promise<SentimentResult[] | null> {
  if (isOnCooldown('gemini')) { console.log('[REFINE] gemini em cooldown'); return null; }
  const clipped = texts.map((t) => (t || "").substring(0, 400).trim());
  const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join("\n");

  const systemPrompt = `Especialista em sentimento político BR. MINIMIZE "Neutro".
Para cada comentário responda em JSON array: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0},...] na MESMA ordem.
POSITIVO (0.7-1.0): apoio, elogio, "mito", torcida, "faz o L", "mitou", emojis ❤️👏🙏🔥👍.
NEGATIVO (0.0-0.3): crítica, xingamento, sarcasmo, ironia, descrédito, "ladrão"/"fora"/"palhaço", gírias "gado"/"mortadela"/"petralha"/"bolsominion"/"coxinha", emojis 🤮👎🤡🙄.
NEUTRO (0.45-0.55): SOMENTE notícia 100% factual, pergunta sem viés ou texto incompreensível. Em dúvida, escolha o lado predominante — sarcasmo é sempre Negativo.`;

  // Backoff exponencial: 3s, 9s, 27s, 60s
  const delays = [3000, 9000, 27000, 60000];
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: clipped.length * 50 + 100,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      const m = content.match(/\[[\s\S]*\]/);
      if (!m) return null;
      try {
        const parsed = JSON.parse(m[0]);
        if (!Array.isArray(parsed) || parsed.length < texts.length) return null;
        return texts.map((_, i) => {
          const p = parsed[i];
          const label =
            p?.label === "Positivo" || p?.label === "Negativo" || p?.label === "Neutro"
              ? p.label
              : "Neutro";
          const score = typeof p?.score === "number" ? Math.max(0, Math.min(1, p.score)) : 0.5;
          return { label, score };
        });
      } catch {
        return null;
      }
    }

    if (res.status === 402) {
      console.error("[REFINE] créditos esgotados — cooldown Gemini 60min");
      setCooldown('gemini', 60);
      return null;
    }
    if (res.status !== 429 && res.status < 500) {
      console.error(`[REFINE] erro ${res.status} não-retentável`);
      return null;
    }

    const wait = delays[attempt] + Math.floor(Math.random() * 2000);
    console.log(`[REFINE] ${res.status} — aguardando ${wait}ms (tentativa ${attempt + 1}/4)`);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.error("[REFINE] esgotou tentativas");
  return null;
}

async function callGeminiDirect(texts: string[], geminiKey: string): Promise<SentimentResult[] | null> {
  const clipped = texts.map((t) => (t || "").substring(0, 400).trim());
  const userContent = clipped.map((t, i) => `${i + 1}. "${t}"`).join("\n");

  const systemPrompt = `Especialista em sentimento político BR. MINIMIZE "Neutro".
Para cada comentário responda em JSON array: [{"label":"Positivo|Negativo|Neutro","score":0.0-1.0},...] na MESMA ordem.
POSITIVO (0.7-1.0): apoio, elogio, torcida, "mito"/"mitou"/"faz o L", emojis ❤️👏🙏🔥👍.
NEGATIVO (0.0-0.3): crítica, xingamento, sarcasmo, ironia, "ladrão"/"fora"/"palhaço", gírias "gado/mortadela/petralha/bolsominion/coxinha", emojis 🤮👎🤡🙄💩.
NEUTRO (0.45-0.55): APENAS notícia factual sem adjetivo, pergunta sem viés ou indecifrável. Em dúvida escolha o lado predominante (sarcasmo = Negativo).`;

  const models = ["gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash"];
  for (const model of models) {
    // Retry com backoff em 503 (sobrecarga)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: "user", parts: [{ text: `Analise:\n${userContent}` }] }],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    label: { type: "string", enum: ["Positivo", "Negativo", "Neutro"] },
                    score: { type: "number" },
                  },
                  required: ["label", "score"],
                },
              },
              temperature: 0.1,
            },
          }),
        });
        if (res.status === 503 || res.status === 429) {
          const wait = (attempt + 1) * 4000 + Math.floor(Math.random() * 2000);
          console.warn(`[REFINE] Gemini Direct ${model} ${res.status} — aguardando ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) {
          console.warn(`[REFINE] Gemini Direct ${model} ${res.status}`);
          break;
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) break;
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.length < texts.length) break;
        return texts.map((_, i) => {
          const p = parsed[i];
          const label =
            p?.label === "Positivo" || p?.label === "Negativo" || p?.label === "Neutro"
              ? p.label : "Neutro";
          const score = typeof p?.score === "number" ? Math.max(0, Math.min(1, p.score)) : 0.5;
          return { label, score };
        });
      } catch (e) {
        console.warn(`[REFINE] Gemini Direct ${model} exceção:`, e);
        break;
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const groqKey = Deno.env.get("GROQ_API_KEY");
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  const cerebrasKey = Deno.env.get("CEREBRAS_API_KEY");

  try {
    // Pega comentários recentes com sentimento pendente ou neutro padrão das últimas 48h.
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: pending, error } = await supabase
      .from("social_interactions")
      .select("id, comment_text")
      .or("and(sentiment_label.eq.Neutro,sentiment_score.eq.0.5),sentiment_label.is.null")
      .gte("created_at", since)
      .not("comment_text", "is", null)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    if (!pending || pending.length === 0) {
      return new Response(
        JSON.stringify({ message: "Nada a refinar.", refined: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    let refined = 0;
    const counts = { Positivo: 0, Negativo: 0, Neutro: 0 };
    const texts = pending.map((p) => p.comment_text || "");

    // 1) Cerebras primeiro (PRIMÁRIO — Llama 3.3 70B, 1M tokens/dia grátis, ~2000 tok/s)
    let results: SentimentResult[] | null = null;
    let providerUsed = "none";
    if (cerebrasKey) {
      results = await callCerebras(texts, cerebrasKey);
      if (results) { console.log("[REFINE] ✅ Cerebras OK"); providerUsed = "cerebras"; }
    }
    // 2) Groq (fallback rápido)
    if (!results && groqKey) {
      results = await callGroq(texts, groqKey);
      if (results) { console.log("[REFINE] ✅ Groq OK"); providerUsed = "groq"; }
    }
    // 2) Lovable AI Gateway
    if (!results && apiKey) {
      results = await callAI(texts, apiKey);
      if (results) { console.log("[REFINE] ✅ Lovable AI OK"); providerUsed = "lovable"; }
    }
    // 3) Gemini Direct API (cota gratuita generosa)
    if (!results && geminiKey) {
      results = await callGeminiDirect(texts, geminiKey);
      if (results) { console.log("[REFINE] ✅ Gemini Direct OK"); providerUsed = "gemini-direct"; }
    }

    if (results) {
      for (let i = 0; i < pending.length; i++) {
        const r = results[i];
        if (!r || (r.label === "Neutro" && r.score === 0.5)) continue;
        await supabase
          .from("social_interactions")
          .update({ sentiment_label: r.label, sentiment_score: r.score })
          .eq("id", pending[i].id);
        refined++;
        counts[r.label]++;
      }
    } else {
      // 3) Heurística pura
      for (const p of pending) {
        const h = heuristic(p.comment_text || "");
        if (h.label !== "Neutro") {
          await supabase
            .from("social_interactions")
            .update({ sentiment_label: h.label, sentiment_score: h.score })
            .eq("id", p.id);
          refined++;
          counts[h.label]++;
        }
      }
    }

    console.log(`[REFINE] provider=${providerUsed} refined=${refined} dist=${JSON.stringify(counts)}`);
    return new Response(
      JSON.stringify({ success: true, provider: providerUsed, candidates: pending.length, refined, distribution: counts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    console.error("[REFINE] erro fatal:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
