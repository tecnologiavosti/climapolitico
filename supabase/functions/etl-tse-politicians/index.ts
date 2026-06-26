// ETL: TSE Candidates -> public.politicians
// Downloads TSE "consulta_cand" CSVs (per year, optionally per UF), parses
// and upserts into the politicians table. Designed to be called on a daily
// cron schedule or manually by an admin.
//
// Query params:
//   year=2022|2024 (default: 2024)
//   uf=SP (optional - if omitted, processes ALL UFs sequentially; for large
//          datasets prefer one UF per invocation)
//
// Auth: requires header `x-etl-token` matching env ETL_INTERNAL_TOKEN
// (set via Lovable Cloud secrets) OR a valid service_role JWT.

import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync, strFromU8 } from "npm:fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-etl-token",
};

const UFS = [
  "AC","AL","AP","AM","BA","BR","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
];

const REGION_BY_UF: Record<string, string> = {
  AC:"norte",AM:"norte",AP:"norte",PA:"norte",RO:"norte",RR:"norte",TO:"norte",
  AL:"nordeste",BA:"nordeste",CE:"nordeste",MA:"nordeste",PB:"nordeste",
  PE:"nordeste",PI:"nordeste",RN:"nordeste",SE:"nordeste",
  DF:"centro-oeste",GO:"centro-oeste",MT:"centro-oeste",MS:"centro-oeste",
  ES:"sudeste",MG:"sudeste",RJ:"sudeste",SP:"sudeste",
  PR:"sul",RS:"sul",SC:"sul",
  BR:"nacional",
};

const CARGO_MAP: Record<string, string> = {
  "PRESIDENTE": "presidente",
  "VICE-PRESIDENTE": "vice_presidente",
  "GOVERNADOR": "governador",
  "VICE-GOVERNADOR": "vice_governador",
  "SENADOR": "senador",
  "1O SUPLENTE": "senador",
  "2O SUPLENTE": "senador",
  "DEPUTADO FEDERAL": "deputado_federal",
  "DEPUTADO ESTADUAL": "deputado_estadual",
  "DEPUTADO DISTRITAL": "deputado_distrital",
  "PREFEITO": "prefeito",
  "VICE-PREFEITO": "vice_prefeito",
  "VEREADOR": "vereador",
};

function normalizeCargo(ds: string): string | null {
  const k = ds?.toUpperCase().trim();
  return CARGO_MAP[k] ?? null;
}

function popularityFor(cargo: string | null, eleito: boolean): number {
  if (!cargo) return 0.1;
  const base: Record<string, number> = {
    presidente: 1.0, vice_presidente: 0.95,
    governador: 0.9, vice_governador: 0.7,
    senador: 0.85, deputado_federal: 0.7,
    deputado_estadual: 0.5, deputado_distrital: 0.5,
    prefeito: 0.4, vice_prefeito: 0.25,
    vereador: 0.15,
  };
  const b = base[cargo] ?? 0.1;
  return eleito ? b : b * 0.5;
}

// Robust CSV row parser for TSE (";"-delimited, quoted, latin1)
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ";") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

async function logRun(sb: any, status: string, payload: any) {
  try {
    await sb.from("edge_function_logs").insert({
      function_name: "etl-tse-politicians",
      status,
      payload,
    });
  } catch (_) { /* logs are best-effort */ }
}

async function processYearUf(
  sb: any,
  year: number,
  uf: string,
): Promise<{ uf: string; rows: number; upserted: number; skipped: number }> {
  const zipUrl = `https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_${year}_${uf}.zip`;
  const res = await fetch(zipUrl);
  if (!res.ok) {
    throw new Error(`TSE fetch failed [${res.status}] ${zipUrl}`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, {
    filter: (f) => /consulta_cand_\d{4}_[A-Z]{2}\.csv$/i.test(f.name),
  });
  const fileName = Object.keys(files)[0];
  if (!fileName) throw new Error(`No CSV inside zip for ${uf}`);

  // TSE files are Latin1 (ISO-8859-1)
  const text = new TextDecoder("iso-8859-1").decode(files[fileName]);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return { uf, rows: 0, upserted: 0, skipped: 0 };

  const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const idx = (name: string) => header.findIndex((h) => h.toUpperCase() === name.toUpperCase());

  const iSq = idx("SQ_CANDIDATO");
  const iNome = idx("NM_CANDIDATO");
  const iUrna = idx("NM_URNA_CANDIDATO");
  const iCargo = idx("DS_CARGO");
  const iSgPart = idx("SG_PARTIDO");
  const iNmPart = idx("NM_PARTIDO");
  const iNrPart = idx("NR_PARTIDO");
  const iUf = idx("SG_UF");
  const iUe = idx("NM_UE");
  const iSit = idx("DS_SIT_TOT_TURNO");
  const iAno = idx("ANO_ELEICAO");
  const iFoto = idx("URL_FOTO") >= 0 ? idx("URL_FOTO") : idx("NR_FOTO");

  if (iSq < 0 || iNome < 0 || iCargo < 0) {
    throw new Error(`Unexpected TSE schema for ${uf}: ${header.join(",")}`);
  }

  const seen = new Set<string>();
  const batch: any[] = [];
  let upserted = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    const { error } = await sb
      .from("politicians")
      .upsert(batch, { onConflict: "tse_id" });
    if (error) {
      console.error("Upsert error", error.message);
      skipped += batch.length;
    } else {
      upserted += batch.length;
    }
    batch.length = 0;
  };

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    const tse_id = cols[iSq]?.replace(/^"|"$/g, "");
    if (!tse_id || seen.has(tse_id)) continue;
    seen.add(tse_id);

    const cargoRaw = cols[iCargo] ?? "";
    const cargo = normalizeCargo(cargoRaw);
    if (!cargo) continue; // skip unmapped (suplentes etc)

    const ufRow = (cols[iUf] ?? uf).toUpperCase();
    const ue = cols[iUe] ?? null;
    const isMunicipal = cargo === "prefeito" || cargo === "vice_prefeito" || cargo === "vereador";
    const municipio = isMunicipal ? ue : null;
    const estado = ufRow === "BR" ? null : ufRow;
    const regiao = REGION_BY_UF[ufRow] ?? null;
    const sit = (cols[iSit] ?? "").toUpperCase();
    const eleito = sit.startsWith("ELEITO");
    const foto_url = iFoto >= 0 ? (cols[iFoto] || null) : null;

    batch.push({
      tse_id,
      nome: (cols[iNome] ?? "").trim(),
      nome_urna: (cols[iUrna] ?? "").trim() || null,
      partido_sigla: (cols[iSgPart] ?? "").trim() || null,
      partido_nome: (cols[iNmPart] ?? "").trim() || null,
      numero_partido: (cols[iNrPart] ?? "").trim() || null,
      cargo,
      regiao,
      estado,
      municipio,
      eleito,
      ativo: true,
      ano_eleicao: parseInt(cols[iAno], 10) || year,
      foto_url: foto_url && /^https?:\/\//.test(foto_url) ? foto_url : null,
      popularidade: popularityFor(cargo, eleito),
    });

    if (batch.length >= 500) await flush();
  }
  await flush();

  return { uf, rows: seen.size, upserted, skipped };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const year = parseInt(url.searchParams.get("year") ?? "2024", 10);
  const ufParam = url.searchParams.get("uf")?.toUpperCase() ?? null;

  // Auth: internal token, service_role, OR authenticated admin user
  const token = req.headers.get("x-etl-token");
  const expected = Deno.env.get("ETL_INTERNAL_TOKEN");
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "");
  const isServiceRole = bearer && bearer === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___none___");
  const hasInternalToken = expected && token === expected;

  let isAdmin = false;
  if (!isServiceRole && !hasInternalToken && bearer) {
    try {
      const sbAuth = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${bearer}` } } },
      );
      const { data: claims } = await sbAuth.auth.getClaims(bearer);
      const uid = claims?.claims?.sub;
      if (uid) {
        const { data: roleRow } = await sbAuth
          .from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
        isAdmin = !!roleRow;
      }
    } catch (_) { /* fallthrough */ }
  }

  if (!isServiceRole && !hasInternalToken && !isAdmin) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }


  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  await logRun(sb, "started", { year, uf: ufParam });

  const targets = ufParam ? [ufParam] : UFS;
  const results: any[] = [];
  for (const uf of targets) {
    try {
      const r = await processYearUf(sb, year, uf);
      results.push(r);
    } catch (e: any) {
      results.push({ uf, error: e.message });
      await logRun(sb, "error", { year, uf, error: e.message });
    }
  }

  await logRun(sb, "completed", { year, uf: ufParam, results });

  return new Response(JSON.stringify({ ok: true, year, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
