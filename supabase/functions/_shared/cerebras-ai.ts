// Shared helper: multi-provider AI calls with automatic fallback chain.
// Chain: Cerebras → Groq → Gemini direct → Lovable AI Gateway
// Each provider is retried on transient errors (429/5xx) with exponential backoff.

export interface CerebrasCallOptions {
  systemMsg: string;
  userPrompt: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
  cerebrasModels?: string[];
  groqModels?: string[];
  geminiModels?: string[];
  lovableModel?: string;
  tag?: string;
  // Max retry attempts per model on transient errors (429, 5xx)
  maxRetries?: number;
}

export interface CerebrasCallResult {
  content: string;
  raw: any;
  provider: "cerebras" | "groq" | "gemini" | "lovable";
  model: string;
  quotaExceeded: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isQuotaError(status: number, text: string): boolean {
  return (
    status === 429 ||
    status === 402 ||
    /quota|rate.?limit|too_many|exceeded|insufficient.?credit|payment.?required/i.test(text)
  );
}

function isRetryableError(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || (status >= 500 && status < 600);
}

async function callWithRetry(
  url: string,
  init: RequestInit,
  maxRetries: number,
  tag: string,
  modelName: string,
): Promise<{ ok: boolean; status: number; text: string; json?: any }> {
  let lastStatus = 0;
  let lastText = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const r = await fetch(url, init);
      if (r.ok) {
        const json = await r.json();
        return { ok: true, status: r.status, text: "", json };
      }
      lastStatus = r.status;
      lastText = (await r.text()).slice(0, 400);
      console.warn(`[${tag}] ${modelName} attempt ${attempt + 1}/${maxRetries + 1} failed ${r.status}: ${lastText.slice(0, 200)}`);
      // Stop retrying on quota/auth errors
      if (isQuotaError(r.status, lastText) || r.status === 401 || r.status === 403) {
        return { ok: false, status: r.status, text: lastText };
      }
      if (!isRetryableError(r.status)) {
        return { ok: false, status: r.status, text: lastText };
      }
      // Exponential backoff with jitter: 500ms, 1.2s, 2.5s...
      if (attempt < maxRetries) {
        const delay = Math.min(500 * Math.pow(2.2, attempt), 5000) + Math.random() * 300;
        await sleep(delay);
      }
    } catch (e) {
      lastText = `network: ${(e as Error).message}`;
      console.warn(`[${tag}] ${modelName} attempt ${attempt + 1} threw: ${lastText}`);
      if (attempt < maxRetries) {
        await sleep(500 * Math.pow(2, attempt) + Math.random() * 300);
      }
    }
  }
  return { ok: false, status: lastStatus || 599, text: lastText || "all retries exhausted" };
}

/**
 * Calls AI with multi-provider fallback. Throws only when ALL providers fail.
 */
export async function callAICerebrasFirst(opts: CerebrasCallOptions): Promise<CerebrasCallResult> {
  const {
    systemMsg,
    userPrompt,
    jsonMode = true,
    maxTokens = 1500,
    temperature = 0.4,
    cerebrasModels = ["qwen-3-235b-a22b-instruct-2507", "llama-3.3-70b", "llama3.1-8b"],
    groqModels = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
    geminiModels = ["gemini-2.0-flash", "gemini-2.0-flash-lite"],
    lovableModel = "google/gemini-2.5-flash",
    tag = "ai",
    maxRetries = 2,
  } = opts;

  const CEREBRAS_API_KEY = Deno.env.get("CEREBRAS_API_KEY");
  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

  let lastErr = "";
  let quotaExceeded = false;

  const messages = [
    { role: "system", content: systemMsg },
    { role: "user", content: userPrompt },
  ];

  // 1) Cerebras
  if (CEREBRAS_API_KEY) {
    for (const model of cerebrasModels) {
      const res = await callWithRetry(
        "https://api.cerebras.ai/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${CEREBRAS_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            max_tokens: maxTokens,
            temperature,
          }),
        },
        maxRetries,
        tag,
        `cerebras:${model}`,
      );
      if (res.ok) {
        const content = res.json?.choices?.[0]?.message?.content ?? "";
        if (content) return { content, raw: res.json, provider: "cerebras", model, quotaExceeded: false };
      }
      lastErr = `cerebras:${model} ${res.status}: ${res.text}`;
      if (isQuotaError(res.status, res.text)) {
        quotaExceeded = true;
        break; // skip remaining cerebras models
      }
    }
  } else {
    lastErr = "CEREBRAS_API_KEY missing";
  }

  // 2) Groq (very fast, generous free tier)
  if (GROQ_API_KEY) {
    for (const model of groqModels) {
      const res = await callWithRetry(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages,
            ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
            max_tokens: maxTokens,
            temperature,
          }),
        },
        maxRetries,
        tag,
        `groq:${model}`,
      );
      if (res.ok) {
        const content = res.json?.choices?.[0]?.message?.content ?? "";
        if (content) return { content, raw: res.json, provider: "groq", model, quotaExceeded };
      }
      lastErr = `groq:${model} ${res.status}: ${res.text}`;
      if (isQuotaError(res.status, res.text)) break;
    }
  }

  // 3) Gemini direct (uses GEMINI_API_KEY)
  if (GEMINI_API_KEY) {
    for (const model of geminiModels) {
      // Gemini-native API: simpler payload
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await callWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { role: "system", parts: [{ text: systemMsg }] },
            contents: [{ role: "user", parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature,
              maxOutputTokens: maxTokens,
              ...(jsonMode ? { responseMimeType: "application/json" } : {}),
            },
          }),
        },
        maxRetries,
        tag,
        `gemini:${model}`,
      );
      if (res.ok) {
        const content =
          res.json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
        if (content) return { content, raw: res.json, provider: "gemini", model, quotaExceeded };
      }
      lastErr = `gemini:${model} ${res.status}: ${res.text}`;
      if (isQuotaError(res.status, res.text)) break;
    }
  }

  // 4) Lovable AI Gateway (last resort)
  if (LOVABLE_API_KEY) {
    const res = await callWithRetry(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: lovableModel,
          messages,
          ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
      },
      maxRetries,
      tag,
      `lovable:${lovableModel}`,
    );
    if (res.ok) {
      const content = res.json?.choices?.[0]?.message?.content ?? "";
      if (content) return { content, raw: res.json, provider: "lovable", model: lovableModel, quotaExceeded };
    }
    lastErr = `lovable:${lovableModel} ${res.status}: ${res.text}`;
    if (res.status === 402) {
      throw new Error("Créditos da IA esgotados. Adicione créditos em Settings > Workspace > Usage.");
    }
    if (res.status === 429) {
      throw new Error("Limite de requisições atingido. Tente novamente em alguns minutos.");
    }
  }

  throw new Error(`AI providers exhausted. Last error: ${lastErr}`);
}
