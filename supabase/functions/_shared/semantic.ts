// Shared semantic engine for Radar Político.
// - Embeddings via Lovable AI Gateway (openai/text-embedding-3-small, 1536 dims)
// - DB cache by content hash
// - Cosine similarity
// - Lightweight NER heuristic (regex + dictionaries, no LLM)
// - Hybrid candidate matching: alias + embedding + NER + role context

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";
const EMBED_DIMS = 1536;

export interface EmbedClient {
  apiKey: string;
  supabase: any; // service-role supabase client
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function embedText(
  client: EmbedClient,
  text: string,
): Promise<number[] | null> {
  const clean = (text || "").trim().slice(0, 8000);
  if (!clean) return null;
  const hash = await sha256Hex(`${EMBED_MODEL}::${clean}`);

  // Cache lookup
  try {
    const { data: cached } = await client.supabase
      .from("embedding_cache")
      .select("embedding")
      .eq("content_hash", hash)
      .maybeSingle();
    if (cached?.embedding) {
      // vector may come back as string "[..]" — normalize
      const arr = typeof cached.embedding === "string"
        ? JSON.parse(cached.embedding)
        : cached.embedding;
      client.supabase
        .from("embedding_cache")
        .update({ hits: undefined, last_used_at: new Date().toISOString() })
        .eq("content_hash", hash)
        .then(() => {}, () => {});
      if (Array.isArray(arr) && arr.length === EMBED_DIMS) return arr as number[];
    }
  } catch { /* ignore cache errors */ }

  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${client.apiKey}`,
      },
      body: JSON.stringify({ model: EMBED_MODEL, input: clean }),
    });
    if (!res.ok) {
      console.warn("[embed] gateway error", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    const vec: number[] | undefined = data?.data?.[0]?.embedding;
    if (!vec || vec.length !== EMBED_DIMS) return null;

    // Cache write (fire-and-forget)
    client.supabase
      .from("embedding_cache")
      .upsert({
        content_hash: hash,
        embedding: vec as any,
        model: EMBED_MODEL,
        last_used_at: new Date().toISOString(),
      }, { onConflict: "content_hash" })
      .then(() => {}, () => {});

    return vec;
  } catch (e) {
    console.warn("[embed] fetch failed", (e as Error).message);
    return null;
  }
}

export function cosineSim(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

// ---------- NER (heurística local) ----------
const PARTY_LIST = ["PT","PL","PSDB","MDB","UNIÃO","UNIAO","PP","REPUBLICANOS","PSD","PDT","PSB","PCdoB","NOVO","PSOL","PODE","PODEMOS","SOLIDARIEDADE","CIDADANIA","REDE","AVANTE","AGIR","PRD"];
const INSTITUTION_LIST = ["STF","TSE","STJ","PF","CGU","TCU","CNJ","BC","BCB","AGU","Senado","Câmara","Camara","Planalto","Itamaraty","COAF","MPF","PGR","CPI","CPMI"];
const ROLE_LIST = ["presidente","ex-presidente","governador","ministro","ministra","senador","senadora","deputado","deputada","prefeito","prefeita","vereador","relator","relatora","procurador","procuradora"];
const STATES = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];

export interface NerResult {
  people: string[];
  parties: string[];
  institutions: string[];
  roles: string[];
  states: string[];
}

export function extractEntities(text: string): NerResult {
  const t = ` ${text} `;
  const norm = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const found = <T>(list: T[], pred: (x: T) => boolean) => list.filter(pred);
  // Pessoas: sequência de 2-4 palavras capitalizadas (heurística PT-BR)
  const people = Array.from(text.matchAll(/\b([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+(?:\s+(?:de|da|do|dos|das)\s+)?(?:\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç]+){1,3})\b/g))
    .map((m) => m[1]).filter((p) => p.split(" ").length >= 2 && p.length < 60);
  return {
    people: Array.from(new Set(people)).slice(0, 10),
    parties: found(PARTY_LIST, (p) => new RegExp(`\\b${p}\\b`, "i").test(norm)),
    institutions: found(INSTITUTION_LIST, (i) => new RegExp(`\\b${i.normalize("NFD").replace(/[\u0300-\u036f]/g,"")}\\b`, "i").test(norm)),
    roles: found(ROLE_LIST, (r) => new RegExp(`\\b${r.normalize("NFD").replace(/[\u0300-\u036f]/g,"")}\\b`, "i").test(norm)),
    states: found(STATES, (s) => new RegExp(`\\b${s}\\b`).test(text)),
  };
}

function nerSignalForCandidate(ner: NerResult, candidate: {
  fullName: string;
  parties?: string[];
  roles?: string[];
  states?: string[];
}): number {
  let score = 0;
  const lastName = candidate.fullName.split(/\s+/).pop()?.toLowerCase() ?? "";
  if (ner.people.some((p) => p.toLowerCase().includes(lastName))) score += 0.6;
  if (candidate.parties?.some((p) => ner.parties.map((x) => x.toUpperCase()).includes(p.toUpperCase()))) score += 0.2;
  if (candidate.roles?.some((r) => ner.roles.map((x) => x.toLowerCase()).includes(r.toLowerCase()))) score += 0.15;
  if (candidate.states?.some((s) => ner.states.includes(s.toUpperCase()))) score += 0.05;
  return Math.min(1, score);
}

export interface SemanticMatchInput {
  article: { title: string; summary?: string };
  articleEmbedding?: number[] | null;
  candidate: {
    fullName: string;
    aliases: string[];
    roleKeywords: string[];
    referenceEmbedding?: number[] | null;
    parties?: string[];
    roles?: string[];
    states?: string[];
  };
}

export interface SemanticMatchResult {
  match: boolean;
  score: number;
  confidence: number;
  reasons: string[];
  signals: { alias: number; embedding: number; ner: number; role: number };
}

function normLocal(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function scoreCandidateMatch(input: SemanticMatchInput): SemanticMatchResult {
  const { article, articleEmbedding, candidate } = input;
  const text = `${article.title} ${article.summary ?? ""}`;
  const norm = normLocal(text);

  // alias signal (0..1)
  const aliasHits = candidate.aliases
    .map((a) => normLocal(a))
    .filter((a) => a.length >= 3 && norm.includes(a)).length;
  const aliasSignal = Math.min(1, aliasHits / 2);

  // role-context signal (0..1)
  const roleHits = candidate.roleKeywords
    .map((r) => normLocal(r))
    .filter((r) => r.length >= 4 && norm.includes(r)).length;
  const roleSignal = Math.min(1, roleHits / 2);

  // embedding signal (0..1) — cosine maps [-1,1] -> clamp to [0,1]
  const cos = (articleEmbedding && candidate.referenceEmbedding)
    ? cosineSim(articleEmbedding, candidate.referenceEmbedding)
    : 0;
  const embSignal = Math.max(0, Math.min(1, (cos + 1) / 2));

  // NER signal (0..1)
  const ner = extractEntities(text);
  const nerSignal = nerSignalForCandidate(ner, {
    fullName: candidate.fullName,
    parties: candidate.parties,
    roles: candidate.roles,
    states: candidate.states,
  });

  const score = aliasSignal * 0.20 + embSignal * 0.35 + nerSignal * 0.25 + roleSignal * 0.20;

  const reasons: string[] = [];
  if (aliasSignal > 0) reasons.push(`alias(${aliasHits})`);
  if (embSignal > 0.55) reasons.push(`semantic(${cos.toFixed(2)})`);
  if (nerSignal > 0) reasons.push(`ner(${nerSignal.toFixed(2)})`);
  if (roleSignal > 0) reasons.push(`role(${roleHits})`);

  return {
    match: score >= 0.60,
    score,
    confidence: score,
    reasons,
    signals: { alias: aliasSignal, embedding: embSignal, ner: nerSignal, role: roleSignal },
  };
}
