// Shared helper: Cerebras-first AI calls with Lovable AI Gateway fallback.
// Used by analytical/insight functions that need high request capacity.

export interface CerebrasCallOptions {
  systemMsg: string;
  userPrompt: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  // Cerebras models to try in order; default = best quality first then fast fallback
  cerebrasModels?: string[];
  // Fallback Lovable AI model if Cerebras fully fails
  lovableModel?: string;
  tag?: string;
}

export interface CerebrasCallResult {
  content: string;
  raw: any;
  provider: "cerebras" | "lovable";
  model: string;
  quotaExceeded: boolean;
}

/**
 * Calls Cerebras first (primary), falls back to Lovable AI Gateway only on failure.
 * Throws on total failure with descriptive message.
 */
export async function callAICerebrasFirst(opts: CerebrasCallOptions): Promise<CerebrasCallResult> {
  const {
    systemMsg,
    userPrompt,
    jsonMode = true,
    maxTokens = 1500,
    temperature = 0.4,
    cerebrasModels = ["qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "llama3.1-8b"],
    lovableModel = "google/gemini-3-flash-preview",
    tag = "ai",
  } = opts;

  const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  let lastErr = "";
  let quotaExceeded = false;

  // 1) Cerebras (primary)
  if (CEREBRAS_API_KEY) {
    for (const model of cerebrasModels) {
      try {
        const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${CEREBRAS_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemMsg },
              { role: "user", content: userPrompt },
            ],
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            max_tokens: maxTokens,
            temperature,
          }),
        });
        if (r.ok) {
          const raw = await r.json();
          const content = raw?.choices?.[0]?.message?.content ?? "";
          return { content, raw, provider: "cerebras", model, quotaExceeded: false };
        }
        const errText = (await r.text()).slice(0, 400);
        lastErr = `cerebras:${model} ${r.status}: ${errText}`;
        console.warn(`[${tag}]`, lastErr);
        if (
          r.status === 429 ||
          /token_quota_exceeded|too_many_tokens|quota/i.test(errText)
        ) {
          quotaExceeded = true;
          break; // skip other Cerebras models, go straight to fallback
        }
      } catch (e) {
        lastErr = `cerebras:${model} threw ${(e as Error).message}`;
        console.warn(`[${tag}]`, lastErr);
      }
    }
  } else {
    quotaExceeded = true;
    lastErr = "CEREBRAS_API_KEY missing";
  }

  // 2) Lovable AI Gateway (fallback)
  if (!LOVABLE_API_KEY) {
    throw new Error(`AI failed: ${lastErr} | LOVABLE_API_KEY missing`);
  }
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: lovableModel,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userPrompt },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) {
    const errText = (await r.text()).slice(0, 400);
    if (r.status === 429) throw new Error("Limite de requisições atingido. Tente novamente em alguns minutos.");
    if (r.status === 402) throw new Error("Créditos da IA esgotados. Adicione créditos em Settings > Workspace > Usage.");
    throw new Error(`AI fallback failed: ${r.status} ${errText} | prior: ${lastErr}`);
  }
  const raw = await r.json();
  const content = raw?.choices?.[0]?.message?.content ?? "";
  return { content, raw, provider: "lovable", model: lovableModel, quotaExceeded };
}
