// Refreshes `trending_candidates_cache` with the most-searched candidate per role,
// computed from real social_interactions volume in the last 7 days.
// Photos are fetched from Wikipedia (pt-br summary endpoint). No mocked data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const ROLES = ["Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito"] as const;
type Role = (typeof ROLES)[number];

interface CandidateRow {
  id: string;
  full_name: string;
  party: string | null;
  region: string | null;
}

async function classifyRoles(
  candidates: CandidateRow[],
): Promise<Record<string, Role | null>> {
  // Ask the AI gateway to classify each candidate into one of the 5 fixed roles.
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.full_name}${c.party ? ` (${c.party})` : ""}${c.region ? ` - ${c.region}` : ""}`)
    .join("\n");

  const prompt = `Classifique cada político brasileiro abaixo em exatamente UM dos cargos: Presidente, Senador, Deputado Federal, Deputado Estadual, Prefeito.
Use o cargo atual ou mais recente conhecido publicamente. Se não tiver certeza, escolha o cargo mais provável.
Responda APENAS um JSON no formato {"results":[{"i":1,"role":"Senador"}, ...]}.

Lista:
${list}`;

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  const out: Record<string, Role | null> = {};
  if (!resp.ok) {
    console.error("[classifyRoles] AI error", resp.status, await resp.text());
    return out;
  }
  try {
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content);
    for (const item of parsed.results ?? []) {
      const idx = Number(item.i) - 1;
      const role = item.role as string;
      if (candidates[idx] && (ROLES as readonly string[]).includes(role)) {
        out[candidates[idx].id] = role as Role;
      }
    }
  } catch (e) {
    console.error("[classifyRoles] parse error", e);
  }
  return out;
}

async function fetchPhoto(fullName: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(fullName)}`,
      { headers: { "User-Agent": "ClimaPoliticoBot/1.0" } },
    );
    if (!r.ok) return null;
    const j = await r.json();
    return j?.thumbnail?.source ?? j?.originalimage?.source ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // 1. Pull all candidates (cross-tenant — public ranking)
  const { data: candidates, error: candErr } = await sb
    .from("candidates")
    .select("id, full_name, party, region")
    .eq("status", "active");
  if (candErr || !candidates || candidates.length === 0) {
    return new Response(JSON.stringify({ error: candErr?.message ?? "no_candidates" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2. Aggregate interaction volume per candidate over the last 7 days
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    const { count } = await sb
      .from("social_interactions")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", c.id)
      .gte("created_at", since);
    counts[c.id] = count ?? 0;
  }

  // 3. Classify each candidate's role via AI
  const roleMap = await classifyRoles(candidates as CandidateRow[]);

  // 4. Pick top 1 per role
  const topByRole: Record<Role, { cand: CandidateRow; mentions: number } | null> = {
    Presidente: null,
    Senador: null,
    "Deputado Federal": null,
    "Deputado Estadual": null,
    Prefeito: null,
  };
  for (const c of candidates as CandidateRow[]) {
    const role = roleMap[c.id];
    if (!role) continue;
    const mentions = counts[c.id] ?? 0;
    const current = topByRole[role];
    if (!current || mentions > current.mentions) {
      topByRole[role] = { cand: c, mentions };
    }
  }

  // 5. Fetch photos + upsert cache
  const upserts = [];
  for (const role of ROLES) {
    const top = topByRole[role];
    if (!top) continue;
    const photo_url = await fetchPhoto(top.cand.full_name);
    upserts.push({
      role,
      candidate_id: top.cand.id,
      full_name: top.cand.full_name,
      party: top.cand.party,
      region: top.cand.region,
      photo_url,
      mentions_count: top.mentions,
      updated_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error: upErr } = await sb
      .from("trending_candidates_cache")
      .upsert(upserts, { onConflict: "role" });
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, refreshed: upserts.length, items: upserts }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
