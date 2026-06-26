// Validação inteligente para cadastro de candidatos.

export const NAME_REGEX = /^[A-Za-zÀ-ÿ'´`~^çÇ\s.-]{6,120}$/;

export const INVALID_NAMES = [
  "batman", "superman", "spiderman", "homem aranha", "homem de ferro",
  "messi", "ronaldo", "neymar", "pele", "pelé", "cr7",
  "trump", "biden", "putin", "obama", "elon musk", "elon",
  "god", "deus", "jesus", "lucifer", "satan", "satanas",
  "admin", "administrador", "teste", "test", "fulano", "ciclano", "beltrano",
];

export const BRAZILIAN_SURNAMES = [
  "silva", "souza", "sousa", "oliveira", "santos", "pereira", "ferreira",
  "costa", "rodrigues", "almeida", "gomes", "martins", "lima", "araujo",
  "araújo", "ribeiro", "carvalho", "barbosa", "rocha", "dias", "cardoso",
  "nascimento", "andrade", "moreira", "nunes", "marques", "machado",
  "freitas", "barros", "cavalcanti", "azevedo", "melo", "mello", "campos",
  "fernandes", "lopes", "vieira", "monteiro", "moura", "cunha", "pinto",
  "teixeira", "correia", "correa", "ramos", "borges", "macedo", "neves",
  "kachan", "bolsonaro", "lula", "alckmin", "haddad", "tarcisio", "caiado",
  "doria", "ciro", "marina", "boulos", "pacheco", "tebet", "freixo",
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

export function isNameFormatValid(name: string): boolean {
  const n = name.trim();
  if (!NAME_REGEX.test(n)) return false;
  const parts = n.split(/\s+/).filter((p) => p.length >= 2);
  return parts.length >= 2;
}

export function isBlacklisted(name: string): boolean {
  const n = norm(name);
  return INVALID_NAMES.some((bad) => n === bad || n.includes(bad));
}

export function hasBrazilianSurname(name: string): boolean {
  const tokens = norm(name).split(/\s+/);
  return tokens.some((t) => BRAZILIAN_SURNAMES.includes(t));
}

export interface ValidationSignals {
  foundInTse?: boolean;       // catálogo local TSE
  foundOnWeb?: boolean;       // lookup IA / web
  webConfidence?: number;     // 0..1
}

export function computeScore(name: string, sig: ValidationSignals): number {
  if (!isNameFormatValid(name)) return 0;
  if (isBlacklisted(name)) return 0;
  let score = 0;
  if (sig.foundInTse) score += 50;
  if (sig.foundOnWeb) score += Math.round(30 * (sig.webConfidence ?? 1));
  if (hasBrazilianSurname(name)) score += 20;
  return Math.min(100, score);
}

export type ValidationStatus = "invalid" | "partial" | "validated";

export function statusFromScore(score: number, formatOk: boolean, blacklisted: boolean): ValidationStatus {
  if (!formatOk || blacklisted) return "invalid";
  if (score >= 60) return "validated";
  if (score >= 30) return "partial";
  return "invalid";
}
