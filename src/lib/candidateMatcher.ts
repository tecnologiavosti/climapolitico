/**
 * Desambiguação contextual para validar se um texto realmente menciona o candidato.
 * Evita falsos positivos como "Cristiano Ronaldo" quando o candidato é "Ronaldo Caiado".
 */

// Blacklist por chave (primeiro nome ou sobrenome em lowercase).
const BLACKLIST: Record<string, string[]> = {
  ronaldo: [
    "cristiano",
    "cr7",
    "fenomeno",
    "fenômeno",
    "real madrid",
    "manchester",
    "futebol",
    "jogador",
    "atacante",
    "nazario",
    "nazário",
    "#ronaldo",
    "selecao",
    "seleção",
  ],
  lula: ["lula molusco", "molusco"],
  bolsonaro: [],
  alckmin: [],
  haddad: [],
  tarcisio: ["tarcisio meira", "tarcísio meira"],
  doria: ["doria júnior"],
};

export interface CandidateContext {
  fullName: string;
  party?: string | null;
  state?: string | null; // UF
  role?: string | null; // ex.: "governador", "presidente", "senador"
  aliases?: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

/**
 * Score de relevância contextual (0 a 1).
 * - Nome completo: +0.7
 * - Nome + sobrenome (ordem livre): +0.5
 * - Só sobrenome: +0.3
 * - Partido / cargo / UF citados: +0.1 cada
 * - Hit em blacklist: -0.4
 */
export function relevanceScore(text: string | null | undefined, ctx: CandidateContext): number {
  if (!text) return 0;
  const t = norm(text);
  const tokens = norm(ctx.fullName).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  const full = tokens.join(" ");

  let score = 0;
  if (t.includes(full)) score += 0.7;
  else if (t.includes(first) && t.includes(last)) score += 0.5;
  else if (t.includes(last) && last.length >= 4) score += 0.3;

  for (const alias of ctx.aliases || []) {
    if (alias && t.includes(norm(alias))) score += 0.4;
  }

  if (ctx.party && t.includes(norm(ctx.party))) score += 0.1;
  if (ctx.state && t.match(new RegExp(`\\b${norm(ctx.state)}\\b`))) score += 0.1;
  if (ctx.role && t.includes(norm(ctx.role))) score += 0.1;

  const bl = BLACKLIST[first] || BLACKLIST[last] || [];
  for (const term of bl) {
    if (t.includes(norm(term))) score -= 0.4;
  }

  return Math.max(0, Math.min(1, score));
}

export function isRelevantMention(
  text: string | null | undefined,
  ctx: CandidateContext,
  threshold = 0.4,
): boolean {
  return relevanceScore(text, ctx) >= threshold;
}
