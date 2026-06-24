/**
 * Normaliza nomes de candidatos para comparação canônica.
 * Remove acentos, pontuação, espaços duplicados e caixa.
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

/** ID canônico = nome normalizado. */
export function canonicalCandidateId(name: string): string {
  return normalizeCandidateName(name);
}

/** Distância de Levenshtein. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
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

/** Similaridade 0..1 baseada em Levenshtein sobre nomes normalizados. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeCandidateName(a);
  const nb = normalizeCandidateName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

export interface DuplicateMatch<T> {
  candidate: T;
  similarity: number;
  exact: boolean;
}

/**
 * Procura duplicata por canonical ID (exato) ou similaridade >= threshold.
 * Retorna o melhor match acima do limite.
 */
export function findDuplicateCandidate<T extends { full_name: string }>(
  newName: string,
  existing: T[],
  threshold = 0.85,
): DuplicateMatch<T> | null {
  const canonical = canonicalCandidateId(newName);
  if (!canonical) return null;

  let best: DuplicateMatch<T> | null = null;
  for (const c of existing) {
    const otherCanonical = canonicalCandidateId(c.full_name);
    if (!otherCanonical) continue;
    if (otherCanonical === canonical) {
      return { candidate: c, similarity: 1, exact: true };
    }
    const sim = nameSimilarity(newName, c.full_name);
    if (sim >= threshold && (!best || sim > best.similarity)) {
      best = { candidate: c, similarity: sim, exact: false };
    }
  }
  return best;
}
