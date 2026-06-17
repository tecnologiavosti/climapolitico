// network-view-sentiment
// Classifica sentimento (pos/neg/neu) de uma lista de textos curtos.
// Usado pela aba Visão por Rede Social para derivar sentimento dos eventos coletados pelo Radar.
//
// Input:  { samples: [{ id: string, text: string }] }
// Output: { results: [{ id, sentiment: 'pos'|'neg'|'neu' }] }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const cache = new Map<string, { at: number; data: any }>();
const CACHE_TTL_MS = 30 * 60_000;

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function classifyLocal(text: string): "pos" | "neg" | "neu" {
  const t = text.toLowerCase();
  const pos = ["aprovad", "vitór", "vitor", "elogi", "destaq", "histórico", "histor", "investiment", "conquist", "ganhou", "venceu", "apoia", "aliad", "sucesso", "favoráv", "favorav"];
  const neg = ["denúnc", "denunc", "escândalo", "escandalo", "operaç", "operac", "prisã", "prisao", "preso", "condenad", "investigaç", "investigac", "corrupç", "corrupc", "renúnc", "renunc", "demiss", "afastad", "crise", "polêm", "polem", "fraude", "ataque", "crime"];
  if (neg.some((k) => t.includes(k))) return "neg";
  if (pos.some((k) => t.includes(k))) return "pos";
  return "neu";
}

async function aiClassify(samples: Array<{ id: string; text: string }>) {
  if (!LOVABLE_API_KEY || samples.length === 0) return null;
  const corpus = samples.map((s, i) => `[${i + 1}] id=${s.id} :: ${s.text.slice(0, 220)}`).join("\n").slice(0, 14000);
  const sys = `Você é analista político brasileiro. Classifique o sentimento POLÍTICO de cada item.
Para cada id, devolva exatamente um de: "pos", "neg", "neu".
- pos: vitória, aprovação, conquista, elogio, apoio relevante.
- neg: denúncia, escândalo, prisão, derrota, crise, operação policial, condenação.
- neu: notícia descritiva, agenda, declaração sem teor avaliativo.
Responda APENAS JSON: {"results":[{"id":"...","sentiment":"pos|neg|neu"}]}`;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: corpus },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) {
    console.error("sentiment ai error", resp.status, await resp.text());
    return null;
  }
  const json = await resp.json();
  const content = json?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    const results: Array<{ id: string; sentiment: "pos" | "neg" | "neu" }> = (parsed.results ?? [])
      .map((r: any) => ({
        id: String(r.id ?? ""),
        sentiment: ["pos", "neg", "neu"].includes(r.sentiment) ? r.sentiment : "neu",
      }))
      .filter((r: any) => r.id);
    return results;
  } catch (e) {
    console.error("sentiment parse error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const samples: Array<{ id: string; text: string }> = Array.isArray(body.samples)
      ? body.samples.filter((s: any) => s && typeof s.id === "string" && typeof s.text === "string")
      : [];
    if (samples.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const key = hashStr(samples.map((s) => s.id + "|" + s.text.slice(0, 60)).join("§"));
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return new Response(JSON.stringify(hit.data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const trimmed = samples.slice(0, 200);
    const ai = await aiClassify(trimmed);
    const byId = new Map<string, "pos" | "neg" | "neu">();
    if (ai) for (const r of ai) byId.set(r.id, r.sentiment);
    // fill missing with local heuristic
    const results = trimmed.map((s) => ({ id: s.id, sentiment: byId.get(s.id) ?? classifyLocal(s.text) }));
    const data = { results };
    cache.set(key, { at: Date.now(), data });
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("network-view-sentiment error", e);
    return new Response(JSON.stringify({ results: [], error: String((e as Error)?.message ?? e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
