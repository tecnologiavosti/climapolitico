// Backfill histórico: usa GDELT DOC API (gratuita, sem chave) para coletar
// notícias dos últimos N meses por candidato e agregar em historical_metrics
// (uma linha por dia / candidato / data_source='gdelt_historical').
// Body: { months?: number (1-12, default 6), candidate_id?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GDELT = "https://api.gdeltproject.org/api/v2/doc/doc";

interface Article { url: string; title: string; seendate: string; domain?: string; tone?: number }

async function fetchMonth(query: string, year: number, month: number): Promise<Article[]> {
  // GDELT aceita startdatetime/enddatetime no formato YYYYMMDDHHMMSS
  const start = `${year}${String(month).padStart(2, "0")}01000000`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}${String(month).padStart(2, "0")}${String(lastDay).padStart(2, "0")}235959`;
  const q = `${query} sourcelang:Portuguese sourcecountry:BR`;
  const url = `${GDELT}?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=250&format=JSON&startdatetime=${start}&enddatetime=${end}&sort=DateDesc`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "ClimaPolitico/1.0" } });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json?.articles) ? json.articles : [];
  } catch {
    return [];
  }
}

function parseDate(s: string): Date | null {
  const m = s?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
}

function nameMatches(text: string, fullName: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const t = norm(text);
  const parts = norm(fullName).split(/\s+/).filter((p) => p.length >= 3);
  if (parts.length === 0) return false;
  if (parts.length >= 2) return t.includes(`${parts[0]} ${parts[parts.length - 1]}`);
  return t.includes(parts[0]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: userRes } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    const user = userRes?.user;
    if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const months = Math.max(1, Math.min(12, Number(body.months) || 6));
    const candidateFilter: string | undefined = body.candidate_id;

    let candQ = supabase.from("candidates").select("id, full_name").eq("user_id", user.id).eq("status", "active");
    if (candidateFilter) candQ = candQ.eq("id", candidateFilter);
    const { data: candidates } = await candQ;
    if (!candidates || candidates.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "Sem candidatos ativos", inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Gera lista de (year, month) dos últimos N meses
    const monthsList: { year: number; month: number }[] = [];
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthsList.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
    }

    let totalInserted = 0;
    const summary: any[] = [];

    for (const cand of candidates) {
      const dayBuckets: Record<string, { mentions: number; toneSum: number; toneCount: number; topics: Set<string> }> = {};

      for (const ym of monthsList) {
        const articles = await fetchMonth(`"${cand.full_name}"`, ym.year, ym.month);
        for (const a of articles) {
          if (!a.title || !nameMatches(a.title, cand.full_name)) continue;
          const d = parseDate(a.seendate);
          if (!d) continue;
          const key = d.toISOString().slice(0, 10);
          const b = dayBuckets[key] || { mentions: 0, toneSum: 0, toneCount: 0, topics: new Set<string>() };
          b.mentions++;
          if (typeof a.tone === "number") { b.toneSum += a.tone; b.toneCount++; }
          if (a.domain) b.topics.add(a.domain);
          dayBuckets[key] = b;
        }
        await new Promise((r) => setTimeout(r, 400)); // rate-limit GDELT
      }

      const rows = Object.entries(dayBuckets).map(([date, b]) => {
        // Tom GDELT: -10..10. Mapeia para 0..100, e quebra em pos/neg/neu por sinal.
        const avgTone = b.toneCount > 0 ? b.toneSum / b.toneCount : 0;
        const score = Math.max(0, Math.min(100, Math.round(50 + avgTone * 5)));
        const pos = avgTone > 1 ? b.mentions : 0;
        const neg = avgTone < -1 ? b.mentions : 0;
        const neu = b.mentions - pos - neg;
        return {
          user_id: user.id,
          candidate_id: cand.id,
          metric_date: date,
          mentions: b.mentions,
          engagement: 0,
          positive_count: pos,
          negative_count: neg,
          neutral_count: neu,
          average_sentiment: score,
          top_topics: Array.from(b.topics).slice(0, 10),
          network_breakdown: { gdelt: b.mentions },
          region_breakdown: {},
          data_source: "gdelt_historical",
        };
      });

      if (rows.length > 0) {
        const { error } = await supabase
          .from("historical_metrics")
          .upsert(rows, { onConflict: "candidate_id,metric_date,data_source" });
        if (error) {
          console.error(`[historical] ${cand.full_name}:`, error.message);
        } else {
          totalInserted += rows.length;
          summary.push({ candidate: cand.full_name, days: rows.length });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, months_scanned: months, inserted: totalInserted, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
