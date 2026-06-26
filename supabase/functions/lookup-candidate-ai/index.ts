// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const VALID_OFFICES = new Set([
  "Presidente", "Vice-presidente", "Ministro", "Governador", "Vice-governador",
  "Secretário Estadual", "Prefeito", "Vice-prefeito", "Secretário Municipal",
  "Senador", "Deputado Federal", "Deputado Estadual", "Deputado Distrital",
  "Vereador", "Presidente de partido",
]);

function normalizeName(value: string) {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function similarity(a: string, b: string) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const contains = nb.includes(na) || na.includes(nb) ? 0.9 : 0;
  const lev = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return Math.max(contains, lev);
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsTerm(haystack: string, term: string) {
  const normalizedTerm = normalizeName(term);
  if (!normalizedTerm) return false;
  if (normalizedTerm.length <= 2) {
    return new RegExp(`(^|\\s)${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(haystack);
  }
  return haystack.includes(normalizedTerm);
}

const OFFICE_ALIASES: Record<string, string[]> = {
  "Presidente": ["presidente"],
  "Vice-presidente": ["vice presidente", "vicepresidente"],
  "Ministro": ["ministro", "ministra"],
  "Governador": ["governador", "governadora"],
  "Vice-governador": ["vice governador", "vice governadora"],
  "Secretário Estadual": ["secretario estadual", "secretaria estadual"],
  "Prefeito": ["prefeito", "prefeita"],
  "Vice-prefeito": ["vice prefeito", "vice prefeita"],
  "Secretário Municipal": ["secretario municipal", "secretaria municipal"],
  "Senador": ["senador", "senadora"],
  "Deputado Federal": ["deputado federal", "deputada federal"],
  "Deputado Estadual": ["deputado estadual", "deputada estadual"],
  "Deputado Distrital": ["deputado distrital", "deputada distrital"],
  "Vereador": ["vereador", "vereadora"],
  "Presidente de partido": ["presidente de partido", "presidente partidario"],
};

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function lookupOfficialSources(name: string) {
  const headers = { Accept: "application/json", "User-Agent": "ClimaPolitico/1.0" };

  try {
    const url = `https://legis.senado.leg.br/dadosabertos/senador/lista/atual?nome=${encodeURIComponent(name)}`;
    const resp = await fetch(url, { headers });
    if (resp.ok) {
      const json: any = await resp.json().catch(() => null);
      const senators = asArray(json?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar);
      const best = senators
        .map((s: any) => {
          const id = s?.IdentificacaoParlamentar ?? {};
          const officialName = String(id?.NomeParlamentar ?? id?.NomeCompletoParlamentar ?? "").trim();
          return { id, officialName, score: similarity(name, officialName) };
        })
        .filter((s) => s.officialName && s.score >= 0.75)
        .sort((a, b) => b.score - a.score)[0];
      if (best) {
        return {
          found: true,
          name: best.officialName,
          party: best.id?.SiglaPartidoParlamentar ?? null,
          office: "Senador",
          state: best.id?.UfParlamentar ?? null,
          city: null,
          confidence: Math.max(0.86, Math.min(0.98, best.score)),
          rationale: "Encontrado na base pública do Senado Federal.",
        };
      }
    }
  } catch (e) {
    console.warn("[lookup-candidate-ai] senate lookup failed", e);
  }

  try {
    const url = `https://dadosabertos.camara.leg.br/api/v2/deputados?nome=${encodeURIComponent(name)}&itens=10&ordem=ASC&ordenarPor=nome`;
    const resp = await fetch(url, { headers });
    if (resp.ok) {
      const json: any = await resp.json().catch(() => null);
      const best = asArray(json?.dados)
        .map((d: any) => ({ d, score: similarity(name, String(d?.nome ?? "")) }))
        .filter((item) => item.d?.nome && item.score >= 0.75)
        .sort((a, b) => b.score - a.score)[0];
      if (best) {
        return {
          found: true,
          name: best.d.nome,
          party: best.d.siglaPartido ?? null,
          office: "Deputado Federal",
          state: best.d.siglaUf ?? null,
          city: null,
          confidence: Math.max(0.86, Math.min(0.98, best.score)),
          rationale: "Encontrado na base pública da Câmara dos Deputados.",
        };
      }
    }
  } catch (e) {
    console.warn("[lookup-candidate-ai] chamber lookup failed", e);
  }

  return null;
}

async function lookupWebEvidence(query: string, originalName: string, ctx: { party: string; office: string; state: string; city: string }) {
  if (!query.trim()) return null;
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "ClimaPolitico/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;

    const html = await resp.text();
    const resultBlocks = html.split(/class=["']result/i).slice(1, 8).join(" ");
    const evidence = normalizeName(stripHtml(resultBlocks || html.slice(0, 20000)));
    if (!evidence) return null;

    let score = 0;
    let max = 0;
    const add = (matches: boolean, weight: number) => {
      max += weight;
      if (matches) score += weight;
    };

    const aliases = generateAliases(originalName).map(normalizeName).filter((alias) => alias.length >= 3);
    add(aliases.some((alias) => containsTerm(evidence, alias) || evidence.includes(alias)), 35);

    if (ctx.office) {
      const officeAliases = OFFICE_ALIASES[ctx.office] ?? [ctx.office];
      add(officeAliases.some((office) => containsTerm(evidence, office)), 15);
    }
    if (ctx.party) add(containsTerm(evidence, ctx.party), 15);
    if (ctx.state) add(containsTerm(evidence, ctx.state), 10);
    if (ctx.city) add(containsTerm(evidence, ctx.city), 25);

    const ratio = max ? score / max : 0;
    if (ratio < 0.6) return null;

    return {
      found: true,
      name: originalName,
      party: ctx.party || null,
      office: VALID_OFFICES.has(ctx.office) ? ctx.office : null,
      state: ctx.state || null,
      city: ctx.city || null,
      confidence: Math.min(0.98, Math.max(0.7, 0.68 + ratio * 0.3)),
      rationale: "Encontrado em fontes públicas brasileiras com correspondência contextual.",
    };
  } catch (e) {
    console.warn("[lookup-candidate-ai] web evidence lookup failed", e);
    return null;
  }
}

const SYSTEM = `Você é um especialista em política brasileira. Identifique políticos
brasileiros (federal, estadual ou municipal) pelo nome, mesmo com apelidos, abreviações,
títulos ("Dr", "Prof", "Sgt"), nomes parciais ou erros de grafia.

Use TODO o contexto fornecido (cargo, partido, estado, município) para desambiguar.
Vereadores e prefeitos locais SÃO políticos válidos — não recuse por falta de fama nacional.

Regras:
- Confidence alta (>0.85) se o contexto bate (cargo + UF + município/partido).
- Confidence média (0.6–0.85) se houver match plausível por sobrenome + UF.
- found=false só se realmente não houver indício de existência política no Brasil.
- NUNCA invente partido, cargo ou local — só preencha se tiver convicção.
- Cargo deve ser um destes: Presidente, Vice-presidente, Ministro, Governador,
  Vice-governador, Secretário Estadual, Prefeito, Vice-prefeito, Secretário Municipal,
  Senador, Deputado Federal, Deputado Estadual, Deputado Distrital, Vereador,
  Presidente de partido.
- Estado: sigla UF de 2 letras, ou null para cargos nacionais.

Responda APENAS com JSON válido:
{"found":boolean,"name":string|null,"party":string|null,"office":string|null,"state":string|null,"city":string|null,"confidence":number,"rationale":string}`;

/** Gera aliases simples a partir de um nome: remove títulos, separa primeiro+sobrenome. */
function generateAliases(name: string): string[] {
  const aliases = new Set<string>([name]);
  const stripped = name.replace(/\b(dr|dra|prof|profa|sgt|cel|cap|ten|pr|pastor|padre|sr|sra)\.?\s+/gi, "").trim();
  if (stripped && stripped !== name) aliases.add(stripped);
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    aliases.add(tokens[tokens.length - 1]); // último sobrenome
    aliases.add(`${tokens[0]} ${tokens[tokens.length - 1]}`); // primeiro+último
  }
  return [...aliases];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    const query = String(body?.query ?? "").trim();
    const ctx = body?.context ?? {};
    const ctxParty = String(ctx?.party ?? "").trim();
    const ctxOffice = String(ctx?.office ?? "").trim();
    const ctxState = String(ctx?.state ?? "").trim();
    const ctxCity = String(ctx?.city ?? "").trim();
    const contextualQuery = query || [name, ctxOffice, ctxParty, ctxCity, ctxState].filter(Boolean).join(" ");

    if (name.length < 3) {
      return new Response(JSON.stringify({ found: false, error: "name too short" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) Fontes oficiais (Senado, Câmara) — só úteis para esses cargos.
    if (!ctxOffice || ctxOffice === "Senador" || ctxOffice === "Deputado Federal") {
      const aliases = generateAliases(name);
      for (const alias of aliases) {
        const official = await lookupOfficialSources(alias);
        if (official) {
          // Se contexto exige UF e bate, sobe confidence; se contradiz, baixa.
          if (ctxState && official.state && ctxState.toUpperCase() !== String(official.state).toUpperCase()) {
            official.confidence = Math.max(0.5, official.confidence - 0.3);
          }
          return new Response(JSON.stringify(official), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 2) Evidência pública contextual. Importante para vereadores/prefeitos locais.
    const webEvidence = await lookupWebEvidence(contextualQuery, name, {
      party: ctxParty,
      office: ctxOffice,
      state: ctxState,
      city: ctxCity,
    });
    if (webEvidence) {
      return new Response(JSON.stringify(webEvidence), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) AI com contexto completo + aliases para apelidos políticos.
    const aliases = generateAliases(name);
    const userPrompt = [
      `Identifique este político brasileiro: "${name}"`,
      contextualQuery ? `Consulta contextual montada: "${contextualQuery}"` : "",
      aliases.length > 1 ? `Possíveis variações/aliases: ${aliases.map((a) => `"${a}"`).join(", ")}` : "",
      "Contexto declarado pelo usuário:",
      ctxOffice ? `- Cargo: ${ctxOffice}` : "",
      ctxParty ? `- Partido: ${ctxParty}` : "",
      ctxState ? `- Estado (UF): ${ctxState}` : "",
      ctxCity ? `- Município: ${ctxCity}` : "",
      "",
      "Use o contexto para encontrar a pessoa correta (vereadores e prefeitos locais contam).",
    ].filter(Boolean).join("\n");

    const callGateway = async () => fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Lovable-API-Key": LOVABLE_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    let resp = await callGateway();
    for (let attempt = 1; attempt <= 3 && resp.status === 429; attempt++) {
      const wait = Math.min(8000, 600 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400);
      console.warn(`[lookup-candidate-ai] 429 — retry ${attempt}/3 in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      resp = await callGateway();
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error("[lookup-candidate-ai] gateway error", resp.status, text);
      const friendly =
        resp.status === 429 ? "rate_limited" :
        resp.status === 402 ? "credits_exhausted" : "ai_gateway_error";
      return new Response(JSON.stringify({ found: false, error: friendly, status: resp.status }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { found: false }; }

    let confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
    const office = typeof parsed.office === "string" && VALID_OFFICES.has(parsed.office) ? parsed.office : null;

    // Score weighting baseado em quanto do contexto bate (nome 35 / cargo 15 / partido 15 / UF 10 / município 25).
    if (parsed.found && parsed.name) {
      const eq = (a: string, b: string) => normalizeName(a) === normalizeName(b);
      let ctxScore = 0; let ctxMax = 0;
      const addSig = (matches: boolean, weight: number) => { ctxMax += weight; if (matches) ctxScore += weight; };
      addSig(similarity(name, parsed.name) >= 0.6 || normalizeName(contextualQuery).includes(normalizeName(parsed.name)), 35);
      if (ctxOffice) addSig(!!office && eq(ctxOffice, office), 15);
      if (ctxParty) addSig(!!parsed.party && eq(ctxParty, parsed.party), 15);
      if (ctxState) addSig(!!parsed.state && ctxState.toUpperCase() === String(parsed.state).toUpperCase(), 10);
      if (ctxCity) addSig(!!parsed.city && eq(ctxCity, parsed.city), 25);
      const ratio = ctxMax ? ctxScore / ctxMax : 0;
      // Combina AI confidence com contexto: média ponderada
      confidence = Math.min(0.99, Math.max(confidence, 0.5 * confidence + 0.5 * ratio));
    }

    // Aceita found=true com limiar mais baixo quando há contexto.
    const minConf = (ctxOffice && ctxParty && ctxState) ? 0.6 : 0.8;
    const accepted = !!parsed.found && confidence >= minConf && !!parsed.name;

    const result = {
      found: accepted,
      name: parsed.name ?? null,
      party: parsed.party ?? ctxParty ?? null,
      office: office ?? (ctxOffice && VALID_OFFICES.has(ctxOffice) ? ctxOffice : null),
      state: parsed.state ?? (ctxState || null),
      city: parsed.city ?? (ctxCity || null),
      confidence,
      rationale: parsed.rationale ?? null,
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[lookup-candidate-ai] error", e);
    return new Response(JSON.stringify({ found: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
