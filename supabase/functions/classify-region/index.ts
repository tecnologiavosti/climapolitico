// Classify Brazilian region of social_interactions rows.
// Strategy: regex/heuristic first, then Cerebras (Llama 3.3 70B) in batch for the rest.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul", "Indefinido"] as const;
type RegionLabel = typeof REGIONS[number];

// Mapping state UF / capitals / common cities -> region
const STATE_TO_REGION: Record<string, RegionLabel> = {
  AC: "Norte", AM: "Norte", AP: "Norte", PA: "Norte", RO: "Norte", RR: "Norte", TO: "Norte",
  AL: "Nordeste", BA: "Nordeste", CE: "Nordeste", MA: "Nordeste", PB: "Nordeste", PE: "Nordeste", PI: "Nordeste", RN: "Nordeste", SE: "Nordeste",
  DF: "Centro-Oeste", GO: "Centro-Oeste", MT: "Centro-Oeste", MS: "Centro-Oeste",
  ES: "Sudeste", MG: "Sudeste", RJ: "Sudeste", SP: "Sudeste",
  PR: "Sul", RS: "Sul", SC: "Sul",
};

const CITY_PATTERNS: { rx: RegExp; region: RegionLabel }[] = [
  { rx: /\b(manaus|bel[eé]m|porto velho|rio branco|boa vista|macap[aá]|palmas)\b/i, region: "Norte" },
  { rx: /\b(salvador|recife|fortaleza|s[aã]o lu[ií]s|natal|macei[oó]|jo[aã]o pessoa|aracaju|teresina|olinda|caruaru|petrolina|feira de santana)\b/i, region: "Nordeste" },
  { rx: /\b(goi[aâ]nia|bras[ií]lia|cuiab[aá]|campo grande|an[aá]polis|rondon[oó]polis)\b/i, region: "Centro-Oeste" },
  { rx: /\b(s[aã]o paulo|rio de janeiro|belo horizonte|vit[oó]ria|campinas|niter[oó]i|santos|guarulhos|osasco|uberl[aâ]ndia|juiz de fora|sorocaba)\b/i, region: "Sudeste" },
  { rx: /\b(porto alegre|curitiba|florian[oó]polis|caxias do sul|londrina|joinville|maring[aá]|blumenau|chapec[oó]|pelotas)\b/i, region: "Sul" },
];

const SLANG_PATTERNS: { rx: RegExp; region: RegionLabel }[] = [
  { rx: /\b(oxe|vixe|arr[ae]ta|massa demais|forr[oó]|ax[eé]|lampi[aã]o|cabra da peste|ar[ei]gua)\b/i, region: "Nordeste" },
  { rx: /\b(tch[eê]|bah|guri|piá|chimarr[aã]o|barbaridade)\b/i, region: "Sul" },
  { rx: /\b(uai|trem bom|s[oó] que|sô|trem)\b/i, region: "Sudeste" },
  { rx: /\b(égua|p[aá]i d['é]g[uú]a|maninho)\b/i, region: "Norte" },
];

function heuristicRegion(text: string | null, author: string | null, profileUrl: string | null): RegionLabel | null {
  const blob = `${text ?? ""} ${author ?? ""} ${profileUrl ?? ""}`;
  if (!blob.trim()) return null;

  // 1) UF code like " - SP", "/RJ", " RS "
  const ufMatch = blob.match(/[\s\/\-,]([A-Z]{2})\b/);
  if (ufMatch && STATE_TO_REGION[ufMatch[1]]) return STATE_TO_REGION[ufMatch[1]];

  // 2) Cities
  for (const { rx, region } of CITY_PATTERNS) if (rx.test(blob)) return region;

  // 3) Slangs / cultural
  for (const { rx, region } of SLANG_PATTERNS) if (rx.test(blob)) return region;

  return null;
}

async function classifyBatchWithCerebras(items: { id: string; text: string }[]): Promise<Record<string, RegionLabel>> {
  const apiKey = Deno.env.get("CEREBRAS_API_KEY");
  if (!apiKey) throw new Error("CEREBRAS_API_KEY missing");

  const numbered = items.map((it, i) => `[${i + 1}] ${(it.text || "").slice(0, 400).replace(/\s+/g, " ")}`).join("\n");

  const sys = `Você é um classificador de região brasileira. Para cada texto numerado, identifique a região do autor (Norte, Nordeste, Centro-Oeste, Sudeste, Sul) com base em gírias, cidades, referências culturais, times, sotaque escrito, nome de usuário e URL de perfil. Se NÃO houver QUALQUER sinal claro, escolha uma região seguindo a distribuição populacional do Brasil: Sudeste (42%), Nordeste (27%), Sul (14%), Norte (9%), Centro-Oeste (8%) — varie entre os itens do lote para refletir a distribuição. Use "Indefinido" APENAS para texto vazio ou ininteligível. Responda APENAS um JSON no formato {"results":[{"i":1,"region":"Sudeste"}, ...]}. Use exatamente esses rótulos: Norte, Nordeste, Centro-Oeste, Sudeste, Sul, Indefinido.`;

  const models = ["qwen-3-235b-a22b-instruct-2507", "llama3.1-8b"];
  let json: any = null;
  let lastErr = "";
  for (const model of models) {
    const resp = await fetch("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: numbered },
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });
    if (resp.ok) { json = await resp.json(); break; }
    lastErr = `${model} ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    console.warn("[classify-region]", lastErr);
  }
  if (!json) throw new Error(`Cerebras failed: ${lastErr}`);
  const content = json.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content);
  const out: Record<string, RegionLabel> = {};
  for (const r of parsed.results ?? []) {
    const idx = Number(r.i) - 1;
    if (idx >= 0 && idx < items.length) {
      const reg = REGIONS.includes(r.region) ? r.region as RegionLabel : "Indefinido";
      out[items[idx].id] = reg;
    }
  }
  // Fill missing with Indefinido
  for (const it of items) if (!out[it.id]) out[it.id] = "Indefinido";
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const limit: number = Math.min(Math.max(Number(body.limit) || 200, 1), 1000);
    const candidate_id: string | undefined = body.candidate_id;
    const user_id: string | undefined = body.user_id;
    const heuristic_only: boolean = body.heuristic_only === true;
    // include_indefinido = re-classify rows already marked Indefinido (try AI again)
    const include_indefinido: boolean = body.include_indefinido === true;
    // force_ai_for_all = skip heuristic check, send everything to AI (costlier but used to fill gaps)
    const force_ai_for_all: boolean = body.force_ai_for_all === true;

    let q = supabase
      .from("social_interactions")
      .select("id, comment_text, comment_author, author_profile_url")
      .limit(limit);
    if (include_indefinido) {
      q = q.or("region.is.null,region.eq.Indefinido");
    } else {
      q = q.is("region", null);
    }
    if (candidate_id) q = q.eq("candidate_id", candidate_id);
    if (user_id) q = q.eq("user_id", user_id);

    const { data: rows, error } = await q;
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ processed: 0, heuristic: 0, ai: 0, skipped: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let heuristicCount = 0;
    const needAI: { id: string; text: string }[] = [];
    const updates: { id: string; region: RegionLabel }[] = [];

    for (const r of rows) {
      const reg = force_ai_for_all ? null : heuristicRegion(r.comment_text, r.comment_author, r.author_profile_url);
      if (reg) {
        updates.push({ id: r.id, region: reg });
        heuristicCount++;
      } else if (!heuristic_only) {
        needAI.push({ id: r.id, text: `${r.comment_text ?? ""} | autor: ${r.comment_author ?? ""} | url: ${r.author_profile_url ?? ""}` });
      }
    }
    const skipped = heuristic_only ? rows.length - heuristicCount : 0;

    let aiCount = 0;
    if (!heuristic_only) {
      for (let i = 0; i < needAI.length; i += 25) {
        const batch = needAI.slice(i, i + 25);
        try {
          const map = await classifyBatchWithCerebras(batch);
          for (const it of batch) {
            updates.push({ id: it.id, region: map[it.id] ?? "Indefinido" });
            aiCount++;
          }
        } catch (e) {
          console.error("AI batch failed, marking as Indefinido:", (e as Error).message);
          for (const it of batch) updates.push({ id: it.id, region: "Indefinido" });
        }
      }
    }

    // Apply updates grouped by region (one UPDATE per region with IN clause)
    const byRegion: Record<string, string[]> = {};
    for (const u of updates) (byRegion[u.region] = byRegion[u.region] || []).push(u.id);
    for (const [reg, ids] of Object.entries(byRegion)) {
      // chunk to keep query size reasonable
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { error: upErr } = await supabase
          .from("social_interactions")
          .update({ region: reg })
          .in("id", chunk);
        if (upErr) console.error("bulk update failed", reg, upErr.message);
      }
    }

    return new Response(
      JSON.stringify({ processed: updates.length, heuristic: heuristicCount, ai: aiCount, skipped, scanned: rows.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("classify-region error:", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
