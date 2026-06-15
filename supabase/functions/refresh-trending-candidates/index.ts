// Refreshes `trending_candidates_cache` with the TOP 5 most-searched
// politicians per role (Presidente, Senador, Deputado Federal,
// Deputado Estadual, Prefeito).
//
// Source of "search interest": public Wikipedia pageviews (pt.wikipedia.org)
// over the last 7 days, via the official Wikimedia REST API. This is an
// external, public indicator of national search interest — no platform
// mentions, no internal news collection, no monitored events.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ROLES = ["Presidente", "Senador", "Deputado Federal", "Deputado Estadual", "Prefeito", "Vereador"] as const;
type Role = (typeof ROLES)[number];

// Pool of currently relevant Brazilian politicians per role. Names come
// from real public office records (used only as the candidate pool to
// poll Wikipedia for); the ranking is fully dynamic from real pageviews.
const POOL: Record<Role, string[]> = {
  Presidente: [
    "Luiz Inácio Lula da Silva", "Jair Bolsonaro", "Tarcísio de Freitas", "Ratinho Júnior",
    "Eduardo Leite", "Romeu Zema", "Pablo Marçal", "Ciro Gomes", "Simone Tebet",
    "Marina Silva", "Geraldo Alckmin", "Sergio Moro", "Michelle Bolsonaro", "Lula da Silva",
    "Fernando Haddad", "Dilma Rousseff", "Michel Temer",
  ],
  Senador: [
    "Davi Alcolumbre", "Renan Calheiros", "Humberto Costa", "Flávio Bolsonaro", "Cid Gomes",
    "Eduardo Girão", "Hamilton Mourão", "Marcos Pontes", "Soraya Thronicke", "Damares Alves",
    "Magno Malta", "Otto Alencar", "Randolfe Rodrigues", "Wellington Dias", "Eliziane Gama",
    "Alessandro Vieira", "Rogério Carvalho", "Cristovam Buarque", "Jaques Wagner", "Omar Aziz",
    "Ana Paula Lobato", "Izalci Lucas", "Astronauta Marcos Pontes",
  ],
  "Deputado Federal": [
    "Nikolas Ferreira", "Erika Hilton", "Tabata Amaral", "Eduardo Bolsonaro", "Carla Zambelli",
    "André Janones", "Guilherme Boulos", "Kim Kataguiri", "Sâmia Bomfim", "Marcel van Hattem",
    "Hugo Motta", "Arthur Lira", "Lindbergh Farias", "Glauber Braga", "Joice Hasselmann",
    "Jandira Feghali", "Adriana Ventura", "Sóstenes Cavalcante", "Bia Kicis", "Gleisi Hoffmann",
    "Talíria Petrone", "Luiz Lima",
  ],
  "Deputado Estadual": [
    "André do Prado", "Carlos Giannazi", "Marina Helou", "Damares Moura", "Daniel José",
    "Lucas Bove", "Caio França", "Bruno Lima", "Janaina Paschoal", "Heni Ozi Cukier",
    "Dimas Ramalho", "Edmir Chedid", "Gustavo Henric Costa", "Tomé Abduch", "Donisete Braga",
    "Tiririca", "Major Olímpio", "Ediane Maria", "Paulo Fiorilo",
  ],
  Prefeito: [
    "Ricardo Nunes", "Eduardo Paes", "Bruno Reis", "Edmilson Rodrigues", "Sebastião Melo",
    "Cícero Lucena", "Topázio Neto", "Edinho Silva", "José Sarto", "Carlos Brandão",
    "Rafael Greca", "Fuad Noman", "João Henrique Caldas", "Adriane Lopes", "David Almeida",
    "Eduardo Pimentel", "Álvaro Dias", "Daniel Sucupira",
  ],
  Vereador: [
    // Vereadores em exercício (mandato 2025-2028) — São Paulo e Rio de Janeiro
    "Carlos Bolsonaro", "Milton Leite", "Rubinho Nunes", "Lucas Pavanato",
    "Cris Monteiro", "Sonaira Fernandes", "Amanda Vettorazzo", "Eli Corrêa Filho",
    "Adilson Amadeu", "Senival Moura", "Marlon Luz", "Rinaldi Digilio",
    "Sandra Tadeu", "Luna Zarattini", "Tânia Bandeira",
    "Tarcísio Motta", "Carlo Caiado", "Vera Lins", "Inaldo Silva", "Pedro Duarte",
    "Monica Benicio", "Thais Ferreira",
  ],
};

const WIKI_HEADERS = {
  "User-Agent": "ClimaPolitico/1.0 (https://climapolitico.lovable.app; admin@climapolitico.app)",
  "Api-User-Agent": "ClimaPolitico/1.0 (https://climapolitico.lovable.app; admin@climapolitico.app)",
  Accept: "application/json",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

async function fetchPageviews(article: string): Promise<number> {
  // Wikipedia's pageview data lags ~2 days; query last 7 fully available days.
  const end = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  const start = new Date(end.getTime() - 6 * 24 * 3600 * 1000);
  const url =
    `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/pt.wikipedia.org/all-access/user/` +
    `${encodeURIComponent(article.replace(/ /g, "_"))}/daily/${fmtDate(start)}/${fmtDate(end)}`;
  try {
    const r = await fetch(url, { headers: WIKI_HEADERS });
    if (!r.ok) return 0;
    const j = await r.json();
    return (j.items ?? []).reduce((s: number, it: { views?: number }) => s + (it.views ?? 0), 0);
  } catch {
    return 0;
  }
}

const PARTY_TOKENS = [
  "PT", "PSDB", "MDB", "PMDB", "PL", "PP", "PSOL", "PSD", "PSB", "UNIÃO", "União Brasil",
  "REPUBLICANOS", "Republicanos", "PSC", "PV", "PCdoB", "REDE", "Rede", "PODEMOS", "Podemos",
  "CIDADANIA", "Cidadania", "NOVO", "Novo", "DEM", "PR", "PRTB", "AVANTE", "Avante",
  "SOLIDARIEDADE", "Solidariedade", "PROS", "PSL", "DC", "PMB", "AGIR",
];
const STATE_TOKENS = [
  "Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo",
  "Goiás", "Maranhão", "Mato Grosso do Sul", "Mato Grosso", "Minas Gerais", "Pará", "Paraíba",
  "Paraná", "Pernambuco", "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul",
  "Rondônia", "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins",
];

function parseMeta(extract: string): { party: string | null; region: string | null } {
  let party: string | null = null;
  for (const p of PARTY_TOKENS) {
    const re = new RegExp(`(?:\\(|\\b)${p.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}(?:\\)|\\b)`);
    if (re.test(extract)) {
      party = p.toUpperCase();
      break;
    }
  }
  let region: string | null = null;
  for (const s of STATE_TOKENS) {
    if (extract.includes(s)) {
      region = s;
      break;
    }
  }
  return { party, region };
}

async function fetchSummary(article: string): Promise<{
  photo: string | null;
  party: string | null;
  region: string | null;
  title: string;
  extract: string;
} | null> {
  try {
    const r = await fetch(
      `https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article.replace(/ /g, "_"))}`,
      { headers: WIKI_HEADERS },
    );
    if (!r.ok) return null;
    const j = await r.json();
    const photo = j?.originalimage?.source ?? j?.thumbnail?.source ?? null;
    const extract = `${j?.description ?? ""} ${j?.extract ?? ""}`;
    const meta = parseMeta(extract);
    return { photo, party: meta.party, region: meta.region, title: j?.title ?? article, extract };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const allUpserts: Array<{
    role: string;
    rank: number;
    candidate_id: null;
    full_name: string;
    party: string | null;
    region: string | null;
    photo_url: string | null;
    mentions_count: number;
    search_score: number;
    updated_at: string;
  }> = [];

  for (const role of ROLES) {
    // 1. Score the pool by real Wikipedia pageviews
    const scores: Array<{ name: string; score: number }> = [];
    for (const name of POOL[role]) {
      const score = await fetchPageviews(name);
      scores.push({ name, score });
      await sleep(120); // throttle Wikimedia API
    }
    scores.sort((a, b) => b.score - a.score);

    // 2. Enrich top candidates with photo + party + region.
    // For Vereador, validate against Wikipedia extract to exclude non-vereadores.
    const candidates = scores.filter((s) => s.score > 0).slice(0, role === "Vereador" ? 12 : 5);
    let rank = 1;
    for (const t of candidates) {
      if (rank > 5) break;
      const meta = await fetchSummary(t.name);
      if (role === "Vereador") {
        const ext = (meta?.extract ?? "").toLowerCase();
        const isVereador = /\bvereador(a|es|as)?\b/.test(ext);
        const hasOtherOffice = /\b(deputad[oa]|senador|prefeit[oa]|governador|ministro|presidente da rep)/.test(ext);
        if (!isVereador || hasOtherOffice) {
          await sleep(120);
          continue;
        }
      }
      allUpserts.push({
        role,
        rank,
        candidate_id: null,
        full_name: meta?.title ?? t.name,
        party: meta?.party ?? null,
        region: meta?.region ?? null,
        photo_url: meta?.photo ?? null,
        mentions_count: 0,
        search_score: t.score,
        updated_at: new Date().toISOString(),
      });
      rank++;
      await sleep(120);
    }
  }

  // 3. Replace cache atomically
  await sb.from("trending_candidates_cache").delete().neq("role", "__never__");
  if (allUpserts.length > 0) {
    const { error: upErr } = await sb.from("trending_candidates_cache").insert(allUpserts);
    if (upErr) {
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, refreshed: allUpserts.length, items: allUpserts }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
