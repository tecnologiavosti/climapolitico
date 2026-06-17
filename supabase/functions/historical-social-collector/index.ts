// Coletor diário do Historical Social Index.
// Faz buscas externas (Firecrawl) por candidato e persiste em historical_social_mentions.
// Pode ser disparado: (1) pelo cron diário (sem corpo / { mode: "daily" }),
// (2) sob demanda pelo network-listening passando candidate_id/name/party/state.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const FIRECRAWL_KEY = Deno.env.get("FIRECRAWL_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SOURCE_TIMEOUT_MS = 9_000;
const MAX_CONCURRENT = 3;
const MAX_CANDIDATES_PER_RUN = 25;

type Network = "twitter" | "youtube" | "facebook" | "instagram" | "tiktok" | "telegram" | "reddit" | "news";

interface SearchHit {
  url?: string;
  title?: string;
  description?: string;
  source?: string;
  date?: string;
}

interface CollectInput {
  candidate_id?: string | null;
  candidate_name: string;
  party?: string | null;
  state?: string | null;
  lookback_days?: number;
}

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9#\s]/g, " ").replace(/\s+/g, " ").trim();
}

function buildTasks(input: CollectInput, dateRange: string) {
  const base = `${input.candidate_name} ${[input.party, input.state].filter(Boolean).join(" ")}`.trim();
  const tasks: Array<{ source: string; net: Network; q: string }> = [
    { source: "google_news", net: "news", q: `${base} política ${dateRange}` },
    { source: "blogs", net: "news", q: `${base} blog política ${dateRange}` },
    { source: "portais", net: "news", q: `${base} jornal portal política ${dateRange}` },
    { source: "twitter", net: "twitter", q: `${base} site:twitter.com OR site:x.com ${dateRange}` },
    { source: "reddit", net: "reddit", q: `${base} site:reddit.com ${dateRange}` },
    { source: "youtube", net: "youtube", q: `${base} site:youtube.com ${dateRange}` },
    { source: "tiktok", net: "tiktok", q: `${base} site:tiktok.com ${dateRange}` },
    { source: "telegram", net: "telegram", q: `${base} site:t.me ${dateRange}` },
    { source: "facebook", net: "facebook", q: `${base} site:facebook.com ${dateRange}` },
    { source: "instagram", net: "instagram", q: `${base} site:instagram.com ${dateRange}` },
  ];
  return tasks;
}

async function firecrawlSearch(q: string, limit = 10): Promise<SearchHit[]> {
  if (!FIRECRAWL_KEY) return [];
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${FIRECRAWL_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, limit, lang: "pt", country: "br" }),
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!r.ok) return [];
    const j = await r.json();
    const raw: any[] = j?.data?.web ?? j?.data ?? j?.results ?? [];
    return raw.slice(0, limit).map((x) => ({
      url: x.url, title: x.title, description: x.description ?? x.snippet ?? "",
      source: x.source ?? x.url, date: x.publishedDate ?? x.date ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function runLimited<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  });
  await Promise.all(workers);
  return out;
}

function parseDate(d?: string): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function extractHashtags(text: string): string[] {
  return Array.from(new Set((text.match(/#[\p{L}0-9_]{3,}/gu) ?? []).map((s) => s.toLowerCase()))).slice(0, 20);
}

async function collectForCandidate(admin: any, input: CollectInput) {
  const lookback = Math.max(1, Math.min(365, input.lookback_days ?? 7));
  const end = new Date();
  const start = new Date(Date.now() - lookback * 86400_000);
  const dateRange = `after:${start.toISOString().slice(0, 10)} before:${end.toISOString().slice(0, 10)}`;

  const { data: run } = await admin.from("historical_social_collector_runs").insert({
    candidate_id: input.candidate_id ?? null,
    candidate_name: input.candidate_name,
    status: "running",
    started_at: new Date().toISOString(),
  }).select("id").single();
  const runId = run?.id;

  const tasks = buildTasks(input, dateRange);
  const results = await runLimited(tasks, MAX_CONCURRENT, async (t) => ({ task: t, hits: await firecrawlSearch(t.q, 10) }));

  const normalizedName = normalizeText(input.candidate_name);
  const rows: any[] = [];
  let sourceOk = 0;
  for (const { task, hits } of results) {
    if (hits.length > 0) sourceOk += 1;
    for (const h of hits) {
      const text = `${h.title ?? ""} ${h.description ?? ""}`.trim();
      if (!text) continue;
      if (/\b(cassino|bet|promoção|cupom|porn|download grátis)\b/i.test(text)) continue;
      rows.push({
        candidate_id: input.candidate_id ?? null,
        candidate_name: input.candidate_name,
        candidate_name_normalized: normalizedName,
        source: task.source,
        network: task.net,
        url: h.url ?? null,
        title: (h.title ?? "").slice(0, 500),
        content: (h.description ?? "").slice(0, 2000),
        date: parseDate(h.date),
        hashtags: extractHashtags(text),
      });
    }
  }

  let inserted = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("historical_social_mentions")
      .upsert(rows, { onConflict: "candidate_name_normalized,source,md5(coalesce(url, title, ''))", ignoreDuplicates: true })
      .select("id");
    // Algumas versões do PostgREST não aceitam expressões em onConflict — fallback: insere ignorando erros de dedup.
    if (error) {
      console.warn("[collector] upsert failed, falling back to per-row insert:", error.message);
      for (const r of rows) {
        const { error: e2 } = await admin.from("historical_social_mentions").insert(r);
        if (!e2) inserted += 1;
      }
    } else {
      inserted = data?.length ?? rows.length;
    }
  }

  if (runId) {
    await admin.from("historical_social_collector_runs").update({
      status: "completed",
      inserted_count: inserted,
      source_count: sourceOk,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }
  return { inserted, source_count: sourceOk, total_hits: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  try {
    // Modo on-demand: 1 candidato específico
    if (body?.candidate_name) {
      const result = await collectForCandidate(admin, body as CollectInput);
      return new Response(JSON.stringify({ ok: true, mode: "on_demand", ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Modo daily: pega lista de candidatos rastreados
    const { data: candidates } = await admin
      .from("candidates")
      .select("id,name,party,state")
      .order("updated_at", { ascending: false })
      .limit(MAX_CANDIDATES_PER_RUN);

    const summary: any[] = [];
    for (const c of candidates ?? []) {
      try {
        const r = await collectForCandidate(admin, {
          candidate_id: c.id, candidate_name: c.name, party: c.party, state: c.state, lookback_days: 2,
        });
        summary.push({ candidate: c.name, ...r });
      } catch (e: any) {
        summary.push({ candidate: c.name, error: e?.message ?? String(e) });
      }
    }
    return new Response(JSON.stringify({ ok: true, mode: "daily", processed: summary.length, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[historical-social-collector]", e?.message ?? e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
