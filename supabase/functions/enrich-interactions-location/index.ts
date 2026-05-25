// Backfill: varre social_interactions com city/state NULL e infere a partir do
// texto + autor usando o mesmo dicionário usado no frontend (lista de cidades BR).
// Roda por user autenticado. Limite seguro de 2000 linhas por chamada.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UF_SET = new Set(["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"]);

const CITY_TO_UF: Record<string, string> = {
  "rio branco":"AC","maceio":"AL","macapa":"AP","manaus":"AM","salvador":"BA","fortaleza":"CE",
  "brasilia":"DF","vitoria":"ES","goiania":"GO","sao luis":"MA","cuiaba":"MT","campo grande":"MS",
  "belo horizonte":"MG","belem":"PA","joao pessoa":"PB","curitiba":"PR","recife":"PE","teresina":"PI",
  "rio de janeiro":"RJ","natal":"RN","porto alegre":"RS","porto velho":"RO","boa vista":"RR",
  "florianopolis":"SC","sao paulo":"SP","aracaju":"SE","palmas":"TO",
  "campinas":"SP","guarulhos":"SP","santos":"SP","sorocaba":"SP","ribeirao preto":"SP",
  "santo andre":"SP","osasco":"SP","sao bernardo do campo":"SP","sao jose dos campos":"SP",
  "niteroi":"RJ","duque de caxias":"RJ","nova iguacu":"RJ","sao goncalo":"RJ","petropolis":"RJ",
  "uberlandia":"MG","contagem":"MG","juiz de fora":"MG","betim":"MG","montes claros":"MG","uberaba":"MG",
  "londrina":"PR","maringa":"PR","foz do iguacu":"PR","ponta grossa":"PR","cascavel":"PR",
  "caxias do sul":"RS","pelotas":"RS","canoas":"RS","santa maria":"RS","gravatai":"RS",
  "joinville":"SC","blumenau":"SC","chapeco":"SC","itajai":"SC","sao jose":"SC",
  "feira de santana":"BA","ilheus":"BA","vitoria da conquista":"BA","camacari":"BA",
  "caruaru":"PE","olinda":"PE","jaboatao dos guararapes":"PE","petrolina":"PE",
  "anapolis":"GO","aparecida de goiania":"GO","rio verde":"GO",
  "imperatriz":"MA","caxias":"MA",
  "feira nova":"PE","parnaiba":"PI",
  "vila velha":"ES","serra":"ES","cariacica":"ES",
  "ananindeua":"PA","santarem":"PA",
  "varzea grande":"MT","rondonopolis":"MT","sinop":"MT",
  "dourados":"MS","tres lagoas":"MS",
  "mossoro":"RN","parnamirim":"RN",
  "joao monlevade":"MG","ipatinga":"MG","governador valadares":"MG",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function infer(text: string): { city: string | null; uf: string | null } {
  const t = ` ${norm(text)} `;
  // 1. Procurar cidade
  for (const [city, uf] of Object.entries(CITY_TO_UF)) {
    if (t.includes(` ${city} `) || t.includes(` ${city},`) || t.includes(` ${city}/`) || t.includes(`-${city}`)) {
      return { city, uf };
    }
  }
  // 2. Sigla UF isolada
  const m = t.match(/[^a-z0-9]([a-z]{2})[^a-z0-9]/gi);
  if (m) {
    for (const tok of m) {
      const sig = tok.replace(/[^a-z]/gi, "").toUpperCase();
      if (UF_SET.has(sig)) return { city: null, uf: sig };
    }
  }
  return { city: null, uf: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const authHeader = req.headers.get("Authorization") || "";
    const apiKeyHeader = req.headers.get("apikey") || "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const cronModeHeader = req.headers.get("x-cron-mode") === "1";
    const token = authHeader.replace("Bearer ", "");

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 2000, 5000);

    // Cron mode: SERVICE_KEY OU (x-cron-mode header + apikey anon válida)
    const isCronMode = token === SERVICE_KEY || (cronModeHeader && apiKeyHeader === ANON_KEY);

    let rows: any[] | null = null;
    let queryErr: any = null;

    if (isCronMode) {
      const { data, error } = await supabase
        .from("social_interactions")
        .select("id, comment_text, comment_author")
        .is("city", null)
        .is("state", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      rows = data; queryErr = error;
    } else {
      const { data: userRes } = await supabase.auth.getUser(token);
      const user = userRes?.user;
      if (!user) return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data, error } = await supabase
        .from("social_interactions")
        .select("id, comment_text, comment_author")
        .eq("user_id", user.id)
        .is("city", null)
        .is("state", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      rows = data; queryErr = error;
    }
    if (queryErr) throw queryErr;

    let enriched = 0;
    for (const r of rows || []) {
      const txt = `${r.comment_text || ""} ${r.comment_author || ""}`;
      if (!txt.trim()) continue;
      const { city, uf } = infer(txt);
      if (!city && !uf) continue;
      const update: any = {};
      if (city) update.city = city;
      if (uf) update.state = uf;
      const { error: upErr } = await supabase.from("social_interactions").update(update).eq("id", r.id);
      if (!upErr) enriched++;
    }

    return new Response(JSON.stringify({ ok: true, scanned: rows?.length || 0, enriched }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
