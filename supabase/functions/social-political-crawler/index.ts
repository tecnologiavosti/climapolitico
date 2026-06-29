// Coleta sinais de pré-candidatura em redes sociais (via Firecrawl Search indexado no Google).
// Roda a cada 6h via cron. Cap de 30 resultados por keyword.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizeName } from "../_shared/normalize-name.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

const KEYWORDS = [
  "pré-candidato",
  "candidatura 2026",
  "eleições 2026",
  "meu nome está à disposição",
  "rumo a Brasília",
  "rumo à prefeitura",
  "vamos reconstruir",
  "conto com vocês em 2026",
];

const SITES = [
  "site:instagram.com",
  "site:tiktok.com",
  "site:facebook.com",
  "site:youtube.com",
];

const PER_QUERY_LIMIT = 10; // ~30+ resultados/keyword distribuídos entre sites
const NAME_REGEX = /\b([A-ZÀ-Ý][a-zà-ÿ]{2,}(?:\s+(?:da|de|do|das|dos|von|del)\s+|\s+)[A-ZÀ-Ý][a-zà-ÿ]{2,}(?:\s+[A-ZÀ-Ý][a-zà-ÿ]{2,})?)\b/g;

interface FirecrawlSearchItem { url?: string; title?: string; description?: string }

async function fcSearch(query: string): Promise<FirecrawlSearchItem[]> {
  if (!FIRECRAWL_API_KEY) return [];
  const r = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${FIRECRAWL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: PER_QUERY_LIMIT, lang: "pt", country: "br", tbs: "qdr:m" }),
  });
  if (!r.ok) {
    console.warn("[crawler] firecrawl", r.status, (await r.text()).slice(0, 200));
    return [];
  }
  const j = await r.json();
  return (j?.data ?? j?.web ?? j?.results ?? []) as FirecrawlSearchItem[];
}

function extractNames(text: string): string[] {
  const matches = text.match(NAME_REGEX) ?? [];
  return Array.from(new Set(matches.map((m) => m.trim()))).filter((n) => n.split(/\s+/).length >= 2);
}

function sourceFromUrl(url?: string): string {
  if (!url) return "web";
  if (/instagram\.com/.test(url)) return "instagram";
  if (/tiktok\.com/.test(url)) return "tiktok";
  if (/facebook\.com/.test(url)) return "facebook";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  return "web";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!FIRECRAWL_API_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "FIRECRAWL_API_KEY missing" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const seen = new Map<string, { name: string; signals: Array<{ source: string; url?: string; snippet?: string; matched_keywords: string[] }> }>();
  let queriesRun = 0;

  for (const kw of KEYWORDS) {
    for (const site of SITES) {
      // Tempo total cap ~50s
      if (Date.now() - startedAt > 50_000) break;
      const items = await fcSearch(`${kw} ${site}`);
      queriesRun++;
      for (const it of items) {
        const blob = `${it.title || ""} ${it.description || ""}`;
        const names = extractNames(blob);
        for (const n of names) {
          const norm = normalizeName(n);
          if (norm.length < 5 || norm.split(" ").length < 2) continue;
          const bucket = seen.get(norm) ?? { name: n, signals: [] };
          if (bucket.signals.length < 6) {
            bucket.signals.push({
              source: sourceFromUrl(it.url),
              url: it.url,
              snippet: blob.slice(0, 280),
              matched_keywords: [kw],
            });
          }
          seen.set(norm, bucket);
        }
      }
    }
  }

  // Skip nomes que já existem como políticos oficiais
  const norms = Array.from(seen.keys());
  if (norms.length === 0) {
    return new Response(JSON.stringify({ ok: true, queriesRun, namesFound: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Classifica via IA cada nome (limite 30 para controlar custo)
  const supabaseFnUrl = `${SUPABASE_URL}/functions/v1/classify-political-figure`;
  const candidates = Array.from(seen.entries()).slice(0, 30);
  let classified = 0;
  let saved = 0;

  for (const [, bucket] of candidates) {
    if (Date.now() - startedAt > 55_000) break;
    try {
      const r = await fetch(supabaseFnUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: bucket.name,
          contexto: bucket.signals.map((s) => s.snippet).join("\n").slice(0, 1500),
          signals: bucket.signals,
        }),
      });
      classified++;
      if (r.ok) {
        const j = await r.json();
        if (j?.is_political && j?.confidence >= 70) saved++;
      }
    } catch (e) {
      console.warn("[crawler] classify failed", (e as Error).message);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsedMs: Date.now() - startedAt,
    queriesRun,
    namesFound: seen.size,
    classified,
    saved,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
