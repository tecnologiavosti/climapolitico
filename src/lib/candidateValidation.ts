// Validação inteligente de candidatos.
// Separa EXISTÊNCIA (score 0–100) de ABRANGÊNCIA POLÍTICA (determinada pelo cargo).

export const NAME_REGEX = /^[A-Za-zÀ-ÿ'´`~^çÇ\s.-]{6,120}$/;

export const INVALID_NAMES = [
  "batman", "superman", "spiderman", "homem aranha", "homem de ferro",
  "mickey mouse", "mickey", "donald duck", "pato donald",
  "messi", "cristiano ronaldo", "neymar", "pele", "pelé", "cr7",
  "trump", "donald trump", "biden", "joe biden", "putin", "vladimir putin",
  "obama", "barack obama", "elon musk", "elon", "bill gates", "zuckerberg",
  "god", "deus", "jesus", "lucifer", "satan", "satanas",
  "admin", "administrador", "teste", "test", "fulano", "ciclano", "beltrano",
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

export interface ExistenceSignals {
  /** Encontrado na tabela TSE local / catálogo oficial. */
  foundInTse?: boolean;
  /** Encontrado em site oficial gov.br / leg.br / câmara / senado / prefeitura. */
  foundInOfficial?: boolean;
  /** Encontrado em rede social verificável. */
  foundInSocial?: boolean;
  /** Encontrado em matérias jornalísticas. */
  foundInNews?: boolean;
}

/**
 * Mapeia o resultado do lookup-candidate-ai (que retorna found + confidence)
 * para os sinais reais de existência. Conservador: confidence alta = fonte oficial.
 */
export function signalsFromAiLookup(
  ai: { found?: boolean; confidence?: number } | null | undefined,
): ExistenceSignals {
  if (!ai?.found) return {};
  const c = ai.confidence ?? 0;
  return {
    foundInOfficial: c >= 0.85,
    foundInNews: c >= 0.6,
    foundInSocial: c >= 0.75,
  };
}

/**
 * Score de EXISTÊNCIA (0–100). Não tem nada a ver com abrangência política.
 * Pesos:
 *  +40 TSE · +30 oficial (gov/leg) · +20 social · +10 jornalismo
 */
export function computeExistenceScore(name: string, sig: ExistenceSignals): number {
  if (!isNameFormatValid(name)) return 0;
  if (isBlacklisted(name)) return 0;
  let s = 0;
  if (sig.foundInTse) s += 40;
  if (sig.foundInOfficial) s += 30;
  if (sig.foundInSocial) s += 20;
  if (sig.foundInNews) s += 10;
  return Math.min(100, s);
}

export type VerificationLevel = "verified" | "partial" | "unverified";

export function levelFromScore(score: number, formatOk: boolean, blacklisted: boolean): VerificationLevel {
  if (!formatOk || blacklisted) return "unverified";
  if (score >= 70) return "verified";
  if (score >= 40) return "partial";
  return "unverified";
}

// ===== Abrangência política — derivada SOMENTE do cargo =====
export type PoliticalScope = "national" | "state" | "municipal" | "none";

const NATIONAL = new Set(["Presidente", "Vice-presidente", "Ministro", "Senador", "Presidente de partido"]);
const STATE = new Set(["Governador", "Vice-governador", "Secretário Estadual", "Deputado Federal", "Deputado Estadual", "Deputado Distrital"]);
const MUNICIPAL = new Set(["Prefeito", "Vice-prefeito", "Secretário Municipal", "Vereador"]);

export function scopeFromPosition(position: string): PoliticalScope {
  if (NATIONAL.has(position)) return "national";
  if (STATE.has(position)) return "state";
  if (MUNICIPAL.has(position)) return "municipal";
  return "none";
}

export function scopeLabel(scope: PoliticalScope, state?: string, city?: string): string {
  if (scope === "national") return "Atuação nacional · Brasil";
  if (scope === "state") return `Atuação estadual${state ? ` · ${state}` : ""}`;
  if (scope === "municipal") {
    const loc = [city, state].filter(Boolean).join("/");
    return `Atuação municipal${loc ? ` · ${loc}` : ""}`;
  }
  return "";
}
