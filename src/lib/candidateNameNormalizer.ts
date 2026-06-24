import Fuse from "fuse.js";

/**
 * Normalização e fuzzy match para nomes de candidatos.
 * Lida com acentos, caixa, espaços, pontuação, ordem de tokens e apelidos.
 */

export function normalizeCandidateName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalCandidateId(name: string): string {
  return normalizeCandidateName(name);
}

function tokens(s: string): string[] {
  return normalizeCandidateName(s).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length, n = b.length;
  const prev: number[] = new Array(n + 1);
  const curr: number[] = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

function stringSim(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** Similaridade simples por Levenshtein sobre nomes normalizados. */
export function nameSimilarity(a: string, b: string): number {
  return stringSim(normalizeCandidateName(a), normalizeCandidateName(b));
}

/**
 * Similaridade tolerante a ordem de tokens e erros de digitação.
 * Considera melhor par de tokens entre input e candidato.
 */
export function fuzzyNameScore(input: string, candidate: string): number {
  const ta = tokens(input);
  const tb = tokens(candidate);
  if (!ta.length || !tb.length) return 0;

  // 1) similaridade da string completa (mesma ordem)
  const full = stringSim(ta.join(" "), tb.join(" "));

  // 2) token-set: melhor matching greedy ignorando ordem
  const used = new Set<number>();
  let sum = 0;
  for (const x of ta) {
    let bestSim = 0, bestIdx = -1;
    for (let j = 0; j < tb.length; j++) {
      if (used.has(j)) continue;
      const s = stringSim(x, tb[j]);
      if (s > bestSim) { bestSim = s; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestSim >= 0.7) {
      used.add(bestIdx);
      sum += bestSim;
    }
  }
  const tokenSet = sum / Math.max(ta.length, tb.length);

  // 3) substring containment (ex: "lula" dentro de "luiz inacio lula da silva")
  const na = normalizeCandidateName(input);
  const nb = normalizeCandidateName(candidate);
  const contain = nb.includes(na) || na.includes(nb) ? 0.9 : 0;

  return Math.max(full, tokenSet, contain);
}

const createSearchableTokens = (name: string, aliases: string[], party?: string, office?: string, state?: string, city?: string) => {
  const base = [name, ...aliases, party, office, state, city].filter(Boolean).join(" ");
  return Array.from(new Set(tokens(base))).sort();
};

/** Catálogo nacional conhecido de políticos brasileiros + apelidos. */
export interface KnownPolitician {
  name: string;
  aliases: string[];
  party?: string;
  office?: string;
  state?: string;
  city?: string;
  searchableTokens: string[];
}

type PoliticianSeed = Omit<KnownPolitician, "searchableTokens">;

const politician = (p: PoliticianSeed): KnownPolitician => ({
  ...p,
  aliases: Array.from(new Set(p.aliases.map((a) => a.trim()).filter(Boolean))),
  searchableTokens: createSearchableTokens(p.name, p.aliases, p.party, p.office, p.state, p.city),
});

export const KNOWN_POLITICIANS: KnownPolitician[] = [
  politician({ name: "Luiz Inácio Lula da Silva", aliases: ["lula", "presidente lula", "luiz lula", "lula da silva"], party: "PT", office: "Presidente" }),
  politician({ name: "Geraldo Alckmin", aliases: ["alckmin", "vice alckmin"], party: "PSB", office: "Vice-presidente" }),
  politician({ name: "Jair Bolsonaro", aliases: ["bolsonaro", "jair messias bolsonaro", "ex-presidente bolsonaro"], party: "PL", office: "Presidente", state: "RJ" }),
  politician({ name: "Damares Alves", aliases: ["damares", "damares alvez", "damares senadora"], party: "REPUBLICANOS", office: "Senador", state: "DF" }),
  politician({ name: "Flávio Bolsonaro", aliases: ["flavio bolsonaro", "senador flavio", "01"], party: "PL", office: "Senador", state: "RJ" }),
  politician({ name: "Eduardo Bolsonaro", aliases: ["eduardo bolsonaro", "03"], party: "PL", office: "Deputado Federal", state: "SP" }),
  politician({ name: "Carlos Bolsonaro", aliases: ["carlos bolsonaro", "02"], party: "PL", office: "Vereador", state: "RJ", city: "Rio de Janeiro" }),
  politician({ name: "Michelle Bolsonaro", aliases: ["michelle", "michelle bolsonaro"], party: "PL", office: "Presidente de partido" }),
  politician({ name: "Tarcísio de Freitas", aliases: ["tarcisio", "tarcisio gomes de freitas"], party: "REPUBLICANOS", office: "Governador", state: "SP" }),
  politician({ name: "Cláudio Castro", aliases: ["claudio castro"], party: "PL", office: "Governador", state: "RJ" }),
  politician({ name: "Ratinho Junior", aliases: ["ratinho", "ratinho jr", "ratinho júnior", "carlos massa junior"], party: "PSD", office: "Governador", state: "PR" }),
  politician({ name: "Ronaldo Caiado", aliases: ["caiado", "caiado ronaldo"], party: "UNIÃO", office: "Governador", state: "GO" }),
  politician({ name: "Romeu Zema", aliases: ["zema"], party: "NOVO", office: "Governador", state: "MG" }),
  politician({ name: "Eduardo Leite", aliases: ["eduardo leite"], party: "PSDB", office: "Governador", state: "RS" }),
  politician({ name: "Jerônimo Rodrigues", aliases: ["jeronimo", "jeronimo rodrigues"], party: "PT", office: "Governador", state: "BA" }),
  politician({ name: "Elmano de Freitas", aliases: ["elmano"], party: "PT", office: "Governador", state: "CE" }),
  politician({ name: "Raquel Lyra", aliases: ["raquel lyra"], party: "PSDB", office: "Governador", state: "PE" }),
  politician({ name: "Helder Barbalho", aliases: ["helder", "helder barbalho"], party: "MDB", office: "Governador", state: "PA" }),
  politician({ name: "Wilson Lima", aliases: ["wilson lima"], party: "UNIÃO", office: "Governador", state: "AM" }),
  politician({ name: "Mauro Mendes", aliases: ["mauro mendes"], party: "UNIÃO", office: "Governador", state: "MT" }),
  politician({ name: "Rafael Fonteles", aliases: ["fonteles", "rafael fonteles"], party: "PT", office: "Governador", state: "PI" }),
  politician({ name: "Fátima Bezerra", aliases: ["fatima", "fatima bezerra"], party: "PT", office: "Governador", state: "RN" }),
  politician({ name: "Paulo Dantas", aliases: ["paulo dantas"], party: "MDB", office: "Governador", state: "AL" }),
  politician({ name: "Renato Casagrande", aliases: ["casagrande"], party: "PSB", office: "Governador", state: "ES" }),
  politician({ name: "Carlos Brandão", aliases: ["brandao", "carlos brandao"], party: "PSB", office: "Governador", state: "MA" }),
  politician({ name: "Jorginho Mello", aliases: ["jorginho mello"], party: "PL", office: "Governador", state: "SC" }),
  politician({ name: "Ibaneis Rocha", aliases: ["ibaneis"], party: "MDB", office: "Governador", state: "DF" }),
  politician({ name: "Gladson Cameli", aliases: ["gladson", "cameli"], party: "PP", office: "Governador", state: "AC" }),
  politician({ name: "Clécio Luís", aliases: ["clecio", "clecio luis"], party: "SOLIDARIEDADE", office: "Governador", state: "AP" }),
  politician({ name: "Marcos Rocha", aliases: ["marcos rocha", "coronel marcos rocha"], party: "UNIÃO", office: "Governador", state: "RO" }),
  politician({ name: "Antonio Denarium", aliases: ["denarium", "antonio denarium"], party: "PP", office: "Governador", state: "RR" }),
  politician({ name: "Wanderlei Barbosa", aliases: ["wanderlei", "wanderlei barbosa"], party: "REPUBLICANOS", office: "Governador", state: "TO" }),
  politician({ name: "João Azevêdo", aliases: ["joao azevedo", "joao azevedo governador"], party: "PSB", office: "Governador", state: "PB" }),
  politician({ name: "Fábio Mitidieri", aliases: ["fabio mitidieri", "mitidieri"], party: "PSD", office: "Governador", state: "SE" }),
  politician({ name: "Eduardo Riedel", aliases: ["riedel", "eduardo riedel"], party: "PSDB", office: "Governador", state: "MS" }),
  politician({ name: "Celina Leão", aliases: ["celina leao", "celina"], party: "PP", office: "Vice-governador", state: "DF" }),
  politician({ name: "Sergio Moro", aliases: ["moro", "sérgio moro"], party: "UNIÃO", office: "Senador", state: "PR" }),
  politician({ name: "Randolfe Rodrigues", aliases: ["randolfe"], party: "PT", office: "Senador", state: "AP" }),
  politician({ name: "Humberto Costa", aliases: ["humberto costa"], party: "PT", office: "Senador", state: "PE" }),
  politician({ name: "Tereza Cristina", aliases: ["tereza cristina"], party: "PP", office: "Senador", state: "MS" }),
  politician({ name: "Marcos Pontes", aliases: ["astronauta marcos pontes", "marcos pontes"], party: "PL", office: "Senador", state: "SP" }),
  politician({ name: "Ciro Nogueira", aliases: ["ciro nogueira"], party: "PP", office: "Senador", state: "PI" }),
  politician({ name: "Magno Malta", aliases: ["magno malta"], party: "PL", office: "Senador", state: "ES" }),
  politician({ name: "Rogério Marinho", aliases: ["rogerio marinho"], party: "PL", office: "Senador", state: "RN" }),
  politician({ name: "Hamilton Mourão", aliases: ["mourao", "hamilton mourao", "general mourao"], party: "REPUBLICANOS", office: "Senador", state: "RS" }),
  politician({ name: "Eduardo Girão", aliases: ["eduardo girao", "girao"], party: "NOVO", office: "Senador", state: "CE" }),
  politician({ name: "Alessandro Vieira", aliases: ["alessandro vieira"], party: "MDB", office: "Senador", state: "SE" }),
  politician({ name: "Omar Aziz", aliases: ["omar", "omar aziz"], party: "PSD", office: "Senador", state: "AM" }),
  politician({ name: "Renan Calheiros", aliases: ["renan", "renan calheiros"], party: "MDB", office: "Senador", state: "AL" }),
  politician({ name: "Jorge Kajuru", aliases: ["kajuru", "jorge kajuru"], party: "PSB", office: "Senador", state: "GO" }),
  politician({ name: "Romário", aliases: ["romario", "romario senador"], party: "PL", office: "Senador", state: "RJ" }),
  politician({ name: "Jaques Wagner", aliases: ["jaques", "jaques wagner"], party: "PT", office: "Senador", state: "BA" }),
  politician({ name: "Eliziane Gama", aliases: ["eliziane", "eliziane gama"], party: "PSD", office: "Senador", state: "MA" }),
  politician({ name: "Nikolas Ferreira", aliases: ["nikolas", "nikolas ferera", "nicolas ferreira"], party: "PL", office: "Deputado Federal", state: "MG" }),
  politician({ name: "André Janones", aliases: ["janones"], party: "AVANTE", office: "Deputado Federal", state: "MG" }),
  politician({ name: "Guilherme Boulos", aliases: ["boulos"], party: "PSOL", office: "Deputado Federal", state: "SP" }),
  politician({ name: "Erika Hilton", aliases: ["erika hilton"], party: "PSOL", office: "Deputado Federal", state: "SP" }),
  politician({ name: "Kim Kataguiri", aliases: ["kim", "kim kataguiri"], party: "UNIÃO", office: "Deputado Federal", state: "SP" }),
  politician({ name: "Marcel van Hattem", aliases: ["marcel", "van hattem", "marcel van hattem"], party: "NOVO", office: "Deputado Federal", state: "RS" }),
  politician({ name: "Sóstenes Cavalcante", aliases: ["sostenes", "sostenes cavalcante"], party: "PL", office: "Deputado Federal", state: "RJ" }),
  politician({ name: "Arthur Lira", aliases: ["lira", "arthur lira"], party: "PP", office: "Deputado Federal", state: "AL" }),
  politician({ name: "Hugo Motta", aliases: ["hugo motta"], party: "REPUBLICANOS", office: "Deputado Federal", state: "PB" }),
  politician({ name: "Gleisi Hoffmann", aliases: ["gleisi", "gleisi hoffmann"], party: "PT", office: "Ministro" }),
  politician({ name: "Valdemar Costa Neto", aliases: ["valdemar", "valdemar costa neto"], party: "PL", office: "Presidente de partido" }),
  politician({ name: "Gilberto Kassab", aliases: ["kassab", "gilberto kassab"], party: "PSD", office: "Presidente de partido" }),
  politician({ name: "Baleia Rossi", aliases: ["baleia", "baleia rossi"], party: "MDB", office: "Presidente de partido" }),
  politician({ name: "Antonio Rueda", aliases: ["rueda", "antonio rueda"], party: "UNIÃO", office: "Presidente de partido" }),
  politician({ name: "Marcos Pereira", aliases: ["marcos pereira republicanos", "marcos pereira"], party: "REPUBLICANOS", office: "Presidente de partido" }),
  politician({ name: "Rui Falcão", aliases: ["rui falcao"], party: "PT", office: "Presidente de partido" }),
  politician({ name: "Simone Tebet", aliases: ["tebet", "simone"], party: "MDB", office: "Ministro" }),
  politician({ name: "Fernando Haddad", aliases: ["haddad"], party: "PT", office: "Ministro" }),
  politician({ name: "Marina Silva", aliases: ["marina"], party: "REDE", office: "Ministro" }),
  politician({ name: "Lucas Pavanato", aliases: ["pavanato", "lucas pavanato"], party: "PL", office: "Vereador", state: "SP", city: "São Paulo" }),
  politician({ name: "Eduardo Paes", aliases: ["eduardo paes", "paes", "prefeito rio"], party: "PSD", office: "Prefeito", state: "RJ", city: "Rio de Janeiro" }),
  politician({ name: "Ricardo Nunes", aliases: ["ricardo nunes", "nunes", "prefeito sao paulo"], party: "MDB", office: "Prefeito", state: "SP", city: "São Paulo" }),
  politician({ name: "Gustavo Martinelli", aliases: ["martinelli", "gustavo marti", "prefeito de jundiai", "prefeito jundiai"], party: "REPUBLICANOS", office: "Prefeito", state: "SP", city: "Jundiaí" }),
  politician({ name: "Fuad Noman", aliases: ["fuad", "fuad noman", "prefeito de bh"], party: "PSD", office: "Prefeito", state: "MG", city: "Belo Horizonte" }),
  politician({ name: "Topázio Neto", aliases: ["topazio", "topazio neto"], party: "PSD", office: "Prefeito", state: "SC", city: "Florianópolis" }),
  politician({ name: "Sebastião Melo", aliases: ["melo", "sebastiao melo"], party: "MDB", office: "Prefeito", state: "RS", city: "Porto Alegre" }),
  politician({ name: "Eduardo Pimentel", aliases: ["pimentel", "eduardo pimentel"], party: "PSD", office: "Prefeito", state: "PR", city: "Curitiba" }),
  politician({ name: "Bruno Reis", aliases: ["bruno reis", "prefeito salvador"], party: "UNIÃO", office: "Prefeito", state: "BA", city: "Salvador" }),
  politician({ name: "João Campos", aliases: ["joao campos", "prefeito recife"], party: "PSB", office: "Prefeito", state: "PE", city: "Recife" }),
  politician({ name: "Evandro Leitão", aliases: ["evandro", "evandro leitao"], party: "PT", office: "Prefeito", state: "CE", city: "Fortaleza" }),
  politician({ name: "David Almeida", aliases: ["david almeida", "prefeito manaus"], party: "AVANTE", office: "Prefeito", state: "AM", city: "Manaus" }),
  politician({ name: "Igor Normando", aliases: ["normando", "igor normando"], party: "MDB", office: "Prefeito", state: "PA", city: "Belém" }),
];

const politicianFuse = new Fuse(KNOWN_POLITICIANS, {
  includeScore: true,
  ignoreDiacritics: true,
  ignoreLocation: true,
  threshold: 0.25,
  keys: [
    { name: "name", weight: 0.45 },
    { name: "aliases", weight: 0.35 },
    { name: "searchableTokens", weight: 0.2 },
  ],
  getFn: (obj, path) => {
    const parts = Array.isArray(path) ? path : path.split(".");
    const value = parts.reduce<any>((acc, key) => acc?.[key], obj);
    if (Array.isArray(value)) return value.map((item) => normalizeCandidateName(String(item)));
    return normalizeCandidateName(String(value ?? ""));
  },
});

export interface NameSuggestion {
  fullName: string;
  similarity: number;
  matchedOn: string; // o termo (alias ou fullName) que bateu
  meta?: { party?: string; position?: string; state?: string; city?: string };
}

const toSuggestion = (p: KnownPolitician, similarity: number, matchedOn: string): NameSuggestion => ({
  fullName: p.name,
  similarity,
  matchedOn,
  meta: { party: p.party, position: p.office, state: p.state, city: p.city },
});

/**
 * Gera sugestões a partir do input contra:
 * - catálogo conhecido (nomes oficiais + apelidos)
 * - nomes adicionais (ex: candidatos já cadastrados pelo usuário, sem auto-correção)
 */
export function suggestCandidateNames(
  input: string,
  knownExtraNames: string[] = [],
  threshold = 0.72,
): NameSuggestion[] {
  const q = input.trim();
  if (q.length < 2) return [];
  const canonicalQ = normalizeCandidateName(q);

  const results: Map<string, NameSuggestion> = new Map();

  // Passo 1: match exato por nome oficial.
  for (const p of KNOWN_POLITICIANS) {
    const official = normalizeCandidateName(p.name);
    if (official === canonicalQ) {
      results.set(official, toSuggestion(p, 1, p.name));
      continue;
    }

    // Passo 2: match exato por alias.
    const exactAlias = p.aliases.find((alias) => normalizeCandidateName(alias) === canonicalQ);
    if (exactAlias) {
      results.set(official, toSuggestion(p, 0.99, exactAlias));
      continue;
    }

    // Passo 3a: score complementar por Levenshtein/token set.
    const terms = [p.name, ...p.aliases, p.searchableTokens.join(" ")];
    let best = 0;
    let matchedOn = p.name;
    for (const t of terms) {
      const s = fuzzyNameScore(q, t);
      if (s > best) { best = s; matchedOn = t; }
    }
    if (best >= threshold) {
      const key = normalizeCandidateName(p.name);
      const existing = results.get(key);
      if (!existing || best > existing.similarity) {
        results.set(key, toSuggestion(p, best, matchedOn));
      }
    }
  }

  // Passo 3b: Fuse.js para typos e nomes parciais, convertido para similaridade >= threshold.
  for (const hit of politicianFuse.search(canonicalQ, { limit: 8 })) {
    const similarity = Math.max(0, 1 - (hit.score ?? 1));
    if (similarity < threshold) continue;
    const key = normalizeCandidateName(hit.item.name);
    const existing = results.get(key);
    if (!existing || similarity > existing.similarity) {
      results.set(key, toSuggestion(hit.item, similarity, "Fuse.js"));
    }
  }

  for (const n of knownExtraNames) {
    const sim = fuzzyNameScore(q, n);
    const key = normalizeCandidateName(n);
    if (sim >= threshold && key !== canonicalQ) {
      const existing = results.get(key);
      if (!existing || sim > existing.similarity) {
        results.set(key, { fullName: n, similarity: sim, matchedOn: n });
      }
    }
  }

  const ranked = Array.from(results.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.log("[CandidateSuggestion]", {
      input: q,
      normalized: canonicalQ,
      total: ranked.length,
      bestMatch: ranked[0] ?? null,
      matches: ranked,
    });
  }

  return ranked;
}

export interface DuplicateMatch<T> {
  candidate: T;
  similarity: number;
  exact: boolean;
}

/**
 * Detecta duplicata considerando catálogo de apelidos + ordem invertida de tokens.
 */
export function findDuplicateCandidate<T extends { full_name: string }>(
  newName: string,
  existing: T[],
  threshold = 0.85,
): DuplicateMatch<T> | null {
  const canonical = canonicalCandidateId(newName);
  if (!canonical) return null;

  // Expande o input via catálogo: se bater forte em apelido, considera o nome oficial.
  const officialFromAlias = (() => {
    for (const p of KNOWN_POLITICIANS) {
      for (const t of [p.name, ...p.aliases]) {
        if (fuzzyNameScore(newName, t) >= 0.92) return p.name;
      }
    }
    return null;
  })();
  const canonicalAliases = new Set<string>([canonical]);
  if (officialFromAlias) canonicalAliases.add(canonicalCandidateId(officialFromAlias));

  let best: DuplicateMatch<T> | null = null;
  for (const c of existing) {
    const otherCanonical = canonicalCandidateId(c.full_name);
    if (!otherCanonical) continue;
    if (canonicalAliases.has(otherCanonical)) {
      return { candidate: c, similarity: 1, exact: true };
    }
    // ordem invertida de tokens
    if (otherCanonical.split(" ").sort().join(" ") === canonical.split(" ").sort().join(" ")) {
      return { candidate: c, similarity: 1, exact: true };
    }
    const sim = fuzzyNameScore(newName, c.full_name);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { candidate: c, similarity: sim, exact: false };
    }
  }
  return best;
}
