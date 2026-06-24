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

/** Catálogo conhecido de figuras políticas brasileiras + apelidos. */
export interface KnownPolitician {
  fullName: string;
  aliases: string[];
  party?: string;
  position?: string;
  state?: string;
}

export const KNOWN_POLITICIANS: KnownPolitician[] = [
  { fullName: "Luiz Inácio Lula da Silva", aliases: ["lula", "presidente lula", "luiz lula", "lula da silva"], party: "PT", position: "Presidente" },
  { fullName: "Jair Bolsonaro", aliases: ["bolsonaro", "jair messias bolsonaro", "ex-presidente bolsonaro"], party: "PL" },
  { fullName: "Flávio Bolsonaro", aliases: ["flavio bolsonaro", "senador flavio", "01"], party: "PL", position: "Senador", state: "RJ" },
  { fullName: "Eduardo Bolsonaro", aliases: ["eduardo bolsonaro", "03"], party: "PL", position: "Deputado Federal", state: "SP" },
  { fullName: "Carlos Bolsonaro", aliases: ["carlos bolsonaro", "02"], party: "PL", position: "Vereador", state: "RJ" },
  { fullName: "Michelle Bolsonaro", aliases: ["michelle"], party: "PL" },
  { fullName: "Geraldo Alckmin", aliases: ["alckmin", "vice alckmin"], party: "PSB", position: "Vice-presidente" },
  { fullName: "Tarcísio de Freitas", aliases: ["tarcisio", "tarcisio gomes de freitas"], party: "REPUBLICANOS", position: "Governador", state: "SP" },
  { fullName: "Cláudio Castro", aliases: ["claudio castro"], party: "PL", position: "Governador", state: "RJ" },
  { fullName: "Ratinho Junior", aliases: ["ratinho", "ratinho jr", "ratinho júnior", "carlos massa junior"], party: "PSD", position: "Governador", state: "PR" },
  { fullName: "Ronaldo Caiado", aliases: ["caiado", "caiado ronaldo"], party: "UNIÃO", position: "Governador", state: "GO" },
  { fullName: "Romeu Zema", aliases: ["zema"], party: "NOVO", position: "Governador", state: "MG" },
  { fullName: "Eduardo Leite", aliases: ["eduardo leite"], party: "PSDB", position: "Governador", state: "RS" },
  { fullName: "Jerônimo Rodrigues", aliases: ["jeronimo", "jeronimo rodrigues"], party: "PT", position: "Governador", state: "BA" },
  { fullName: "Elmano de Freitas", aliases: ["elmano"], party: "PT", position: "Governador", state: "CE" },
  { fullName: "Raquel Lyra", aliases: ["raquel lyra"], party: "PSDB", position: "Governadora", state: "PE" },
  { fullName: "Helder Barbalho", aliases: ["helder"], party: "MDB", position: "Governador", state: "PA" },
  { fullName: "Wilson Lima", aliases: ["wilson lima"], party: "UNIÃO", position: "Governador", state: "AM" },
  { fullName: "Mauro Mendes", aliases: ["mauro mendes"], party: "UNIÃO", position: "Governador", state: "MT" },
  { fullName: "Nikolas Ferreira", aliases: ["nikolas", "nikolas ferera", "nicolas ferreira"], party: "PL", position: "Deputado Federal", state: "MG" },
  { fullName: "André Janones", aliases: ["janones"], party: "AVANTE", position: "Deputado Federal", state: "MG" },
  { fullName: "Guilherme Boulos", aliases: ["boulos"], party: "PSOL", position: "Deputado Federal", state: "SP" },
  { fullName: "Erika Hilton", aliases: ["erika hilton"], party: "PSOL", position: "Deputada Federal", state: "SP" },
  { fullName: "Pablo Marçal", aliases: ["marçal", "marcal", "pablo marcal"], party: "PRTB" },
  { fullName: "Ciro Gomes", aliases: ["ciro"], party: "PDT" },
  { fullName: "Simone Tebet", aliases: ["tebet", "simone"], party: "MDB", position: "Ministro" },
  { fullName: "Fernando Haddad", aliases: ["haddad"], party: "PT", position: "Ministro" },
  { fullName: "Marina Silva", aliases: ["marina"], party: "REDE", position: "Ministro" },
  { fullName: "Gleisi Hoffmann", aliases: ["gleisi"], party: "PT" },
  { fullName: "Sergio Moro", aliases: ["moro", "sérgio moro"], party: "UNIÃO", position: "Senador", state: "PR" },
  { fullName: "Lucas Pavanato", aliases: ["pavanato", "lucas pavanato"], party: "PL", position: "Deputado Estadual", state: "SP" },
  { fullName: "Kim Kataguiri", aliases: ["kim", "kim kataguiri"], party: "UNIÃO", position: "Deputado Federal", state: "SP" },
  { fullName: "Marcel van Hattem", aliases: ["marcel", "van hattem", "marcel van hattem"], party: "NOVO", position: "Deputado Federal", state: "RS" },
  { fullName: "Eduardo Paes", aliases: ["eduardo paes", "paes"], party: "PSD", position: "Prefeito", state: "RJ" },
  { fullName: "Ricardo Nunes", aliases: ["ricardo nunes", "nunes"], party: "MDB", position: "Prefeito", state: "SP" },
  // Prefeitos de capitais e cidades-chave
  { fullName: "Gustavo Martinelli", aliases: ["martinelli", "gustavo marti", "prefeito de jundiai", "prefeito jundiai"], party: "REPUBLICANOS", position: "Prefeito", state: "SP" },
  { fullName: "Fuad Noman", aliases: ["fuad", "fuad noman", "prefeito de bh"], party: "PSD", position: "Prefeito", state: "MG" },
  { fullName: "Topázio Neto", aliases: ["topazio", "topazio neto"], party: "PSD", position: "Prefeito", state: "SC" },
  { fullName: "Sebastião Melo", aliases: ["melo", "sebastiao melo"], party: "MDB", position: "Prefeito", state: "RS" },
  { fullName: "Eduardo Pimentel", aliases: ["pimentel", "eduardo pimentel"], party: "PSD", position: "Prefeito", state: "PR" },
  { fullName: "Bruno Reis", aliases: ["bruno reis", "prefeito salvador"], party: "UNIÃO", position: "Prefeito", state: "BA" },
  { fullName: "João Campos", aliases: ["joao campos", "prefeito recife"], party: "PSB", position: "Prefeito", state: "PE" },
  { fullName: "Evandro Leitão", aliases: ["evandro", "evandro leitao"], party: "PT", position: "Prefeito", state: "CE" },
  { fullName: "David Almeida", aliases: ["david almeida", "prefeito manaus"], party: "AVANTE", position: "Prefeito", state: "AM" },
  { fullName: "Igor Normando", aliases: ["normando", "igor normando"], party: "MDB", position: "Prefeito", state: "PA" },
  // Governadores adicionais
  { fullName: "Rafael Fonteles", aliases: ["fonteles", "rafael fonteles"], party: "PT", position: "Governador", state: "PI" },
  { fullName: "Fátima Bezerra", aliases: ["fatima", "fatima bezerra"], party: "PT", position: "Governadora", state: "RN" },
  { fullName: "Paulo Dantas", aliases: ["paulo dantas"], party: "MDB", position: "Governador", state: "AL" },
  { fullName: "Renato Casagrande", aliases: ["casagrande"], party: "PSB", position: "Governador", state: "ES" },
  { fullName: "Carlos Brandão", aliases: ["brandao", "carlos brandao"], party: "PSB", position: "Governador", state: "MA" },
  { fullName: "Jorginho Mello", aliases: ["jorginho mello"], party: "PL", position: "Governador", state: "SC" },
  { fullName: "Ratinho Junior", aliases: ["ratinho", "ratinho jr"], party: "PSD", position: "Governador", state: "PR" },
];

export interface NameSuggestion {
  fullName: string;
  similarity: number;
  matchedOn: string; // o termo (alias ou fullName) que bateu
  meta?: { party?: string; position?: string; state?: string };
}

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

  for (const p of KNOWN_POLITICIANS) {
    const terms = [p.fullName, ...p.aliases];
    let best = 0;
    let matchedOn = p.fullName;
    for (const t of terms) {
      const s = fuzzyNameScore(q, t);
      if (s > best) { best = s; matchedOn = t; }
    }
    if (best >= threshold) {
      const key = normalizeCandidateName(p.fullName);
      const existing = results.get(key);
      if (!existing || best > existing.similarity) {
        results.set(key, {
          fullName: p.fullName,
          similarity: best,
          matchedOn,
          meta: { party: p.party, position: p.position, state: p.state },
        });
      }
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
    .filter((r) => normalizeCandidateName(r.fullName) !== canonicalQ)
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
      for (const t of [p.fullName, ...p.aliases]) {
        if (fuzzyNameScore(newName, t) >= 0.92) return p.fullName;
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
