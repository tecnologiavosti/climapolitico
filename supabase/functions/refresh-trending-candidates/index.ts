// Refreshes `trending_candidates_cache` with the most-searched candidate per role.
// Volume = real social_interactions in the last 7 days.
// Role + photo are inferred from the candidate's public Wikipedia (pt) summary,
// so no AI credits are required. No mock data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLES = ["Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito"] as const;
type Role = (typeof ROLES)[number];

interface CandidateRow {
  id: string;
  full_name: string;
  party: string | null;
  region: string | null;
}

function inferRoleFromText(text: string): Role | null {
  const t = text.toLowerCase();
  // Order matters: most specific role labels first; ignore "ex-presidente"
  // or "filho do presidente" so we capture the candidate's own current role.
  if (/\bsenador[a]?\b/.test(t)) return "Senador";
  if (/\bdeputad[oa] federal\b/.test(t)) return "Deputado Federal";
  if (/\bdeputad[oa] estadual\b|\bdeputad[oa] distrital\b/.test(t)) return "Deputado Estadual";
  if (/\bprefeit[oa]\b/.test(t)) return "Prefeito";
  if (/\bpresident[ea] (da rep[uú]blica|do brasil)\b/.test(t)) return "Presidente";
  if (/\bdeputad[oa]\b/.test(t)) return "Deputado Federal";
  return null;
}

const WIKI_HEADERS = {
  "User-Agent": "ClimaPolitico/1.0 (https://climapolitico.lovable.app; admin@climapolitico.app)",
  "Api-User-Agent": "ClimaPolitico/1.0 (https://climapolitico.lovable.app; admin@climapolitico.app)",
  Accept: "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikipedia(fullName: string): Promise<{ photo: string | null; role: Role | null }> {
  try {
    const r = await fetch(
      `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(fullName)}`,
      { headers: WIKI_HEADERS },
    );
    if (!r.ok) {
      console.log(`[wiki] ${fullName} -> HTTP ${r.status}`);
      return { photo: null, role: null };
    }
    const j = await r.json();
    const photo = j?.originalimage?.source ?? j?.thumbnail?.source ?? null;
    const extract = `${j?.description ?? ""} ${j?.extract ?? ""}`;
    const role = inferRoleFromText(extract);
    return { photo, role };
  } catch (e) {
    console.log(`[wiki] ${fullName} -> error ${(e as Error).message}`);
    return { photo: null, role: null };
  }
}

// Fallback: when our monitored candidates do not cover a role,
// query the public Wikipedia API to find a real current office-holder.
// Seeds are real, currently-in-office Brazilian politicians used only as
// search seeds — actual photo/name/role come from Wikipedia at runtime.
const FALLBACK_SEEDS: Record<Role, string[]> = {
  Presidente: ["Luiz Inácio Lula da Silva", "Jair Bolsonaro"],
  Senador: ["Davi Alcolumbre", "Renan Calheiros", "Humberto Costa"],
  "Deputado Federal": ["Arthur Lira", "Hugo Motta", "Lindbergh Farias"],
  "Deputado Estadual": [
    "André do Prado",
    "Damares Moura",
    "Carlos Giannazi",
    "Marina Helou",
    "Erika Hilton",
  ],
  Prefeito: ["Ricardo Nunes", "Eduardo Paes", "Bruno Reis"],
};

async function fallbackFromWikipedia(role: Role): Promise<{
  full_name: string;
  party: string | null;
  region: string | null;
  photo_url: string | null;
} | null> {
  console.log(`[fallback] trying role=${role}`);
  for (const seed of FALLBACK_SEEDS[role]) {
    const wiki = await fetchWikipedia(seed);
    console.log(`[fallback] seed=${seed} photo=${wiki.photo ? "yes" : "no"}`);
    if (wiki.photo) {
      return { full_name: seed, party: null, region: null, photo_url: wiki.photo };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

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

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const enriched: Array<{ cand: CandidateRow; mentions: number; role: Role | null; photo: string | null }> = [];

  for (const c of candidates as CandidateRow[]) {
    const { count } = await sb
      .from("social_interactions")
      .select("id", { count: "exact", head: true })
      .eq("candidate_id", c.id)
      .gte("created_at", since);
    const wiki = await fetchWikipedia(c.full_name);
    enriched.push({ cand: c, mentions: count ?? 0, role: wiki.role, photo: wiki.photo });
    await sleep(150); // throttle Wikipedia REST API
  }

  const topByRole: Record<Role, typeof enriched[number] | null> = {
    Presidente: null,
    Senador: null,
    "Deputado Federal": null,
    "Deputado Estadual": null,
    Prefeito: null,
  };
  for (const e of enriched) {
    if (!e.role) continue;
    const cur = topByRole[e.role];
    if (!cur || e.mentions > cur.mentions) topByRole[e.role] = e;
  }

  const upserts = [];
  for (const role of ROLES) {
    const top = topByRole[role];
    if (top) {
      upserts.push({
        role,
        candidate_id: top.cand.id,
        full_name: top.cand.full_name,
        party: top.cand.party,
        region: top.cand.region,
        photo_url: top.photo,
        mentions_count: top.mentions,
        updated_at: new Date().toISOString(),
      });
    } else {
      const fb = await fallbackFromWikipedia(role);
      if (fb) {
        upserts.push({
          role,
          candidate_id: null,
          full_name: fb.full_name,
          party: fb.party,
          region: fb.region,
          photo_url: fb.photo_url,
          mentions_count: 0,
          updated_at: new Date().toISOString(),
        });
      }
    }
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
