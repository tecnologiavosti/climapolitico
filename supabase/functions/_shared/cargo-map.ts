export const CARGO_MAP = {
  presidente: "PRESIDENTE",
  "vice-presidente": "VICE-PRESIDENTE",
  ministro: "MINISTRO DE ESTADO",
  governador: "GOVERNADOR",
  "vice-governador": "VICE-GOVERNADOR",
  senador: "SENADOR",
  "deputado federal": "DEPUTADO FEDERAL",
  "deputado estadual": "DEPUTADO ESTADUAL",
  "deputado distrital": "DEPUTADO DISTRITAL",
  prefeito: "PREFEITO",
  "vice-prefeito": "VICE-PREFEITO",
  vereador: "VEREADOR",
} as const;

export type CargoSlug =
  | "presidente"
  | "vice_presidente"
  | "ministro"
  | "governador"
  | "vice_governador"
  | "senador"
  | "deputado_federal"
  | "deputado_estadual"
  | "deputado_distrital"
  | "prefeito"
  | "vice_prefeito"
  | "vereador";

export const CARGO_KEY_TO_TSE_LABEL: Record<CargoSlug, string> = {
  presidente: CARGO_MAP.presidente,
  vice_presidente: CARGO_MAP["vice-presidente"],
  ministro: CARGO_MAP.ministro,
  governador: CARGO_MAP.governador,
  vice_governador: CARGO_MAP["vice-governador"],
  senador: CARGO_MAP.senador,
  deputado_federal: CARGO_MAP["deputado federal"],
  deputado_estadual: CARGO_MAP["deputado estadual"],
  deputado_distrital: CARGO_MAP["deputado distrital"],
  prefeito: CARGO_MAP.prefeito,
  vice_prefeito: CARGO_MAP["vice-prefeito"],
  vereador: CARGO_MAP.vereador,
};

const TSE_LABEL_TO_CARGO_KEY = Object.fromEntries(
  Object.entries(CARGO_KEY_TO_TSE_LABEL).map(([key, label]) => [normalizeCargoText(label), key]),
) as Record<string, CargoSlug>;

const CARGO_ALIASES: Record<string, CargoSlug> = {
  presidente: "presidente",
  "presidente da republica": "presidente",
  "vice presidente": "vice_presidente",
  vicepresidente: "vice_presidente",
  "vice presidente da republica": "vice_presidente",
  ministro: "ministro",
  "ministro de estado": "ministro",
  governador: "governador",
  "vice governador": "vice_governador",
  vicegovernador: "vice_governador",
  senador: "senador",
  senadora: "senador",
  "deputado federal": "deputado_federal",
  "deputada federal": "deputado_federal",
  deputado: "deputado_federal",
  "deputado estadual": "deputado_estadual",
  "deputada estadual": "deputado_estadual",
  "deputado distrital": "deputado_distrital",
  "deputada distrital": "deputado_distrital",
  prefeito: "prefeito",
  prefeita: "prefeito",
  "vice prefeito": "vice_prefeito",
  "vice prefeita": "vice_prefeito",
  viceprefeito: "vice_prefeito",
  vereador: "vereador",
  vereadora: "vereador",
};

export const MUNICIPAL_CARGO_KEYS = new Set<CargoSlug>(["prefeito", "vice_prefeito", "vereador"]);
export const NATIONAL_CARGO_KEYS = new Set<CargoSlug>(["presidente", "vice_presidente"]);

export function normalizeCargoText(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function canonicalCargoKey(value: unknown): CargoSlug | null {
  const normalized = normalizeCargoText(value);
  if (!normalized) return null;
  return CARGO_ALIASES[normalized] ?? TSE_LABEL_TO_CARGO_KEY[normalized] ?? null;
}

export function cargoKeyFromTseLabel(value: unknown): CargoSlug | null {
  return TSE_LABEL_TO_CARGO_KEY[normalizeCargoText(value)] ?? null;
}

export function cargoLabelForKey(key: string | null | undefined): string | null {
  return key && key in CARGO_KEY_TO_TSE_LABEL ? CARGO_KEY_TO_TSE_LABEL[key as CargoSlug] : null;
}

export function electionYearForCargo(key: string | null | undefined): number {
  return key && MUNICIPAL_CARGO_KEYS.has(key as CargoSlug) ? 2024 : 2022;
}

export function shouldUseMunicipio(cargos: string[]): boolean {
  return cargos.length === 0 || cargos.every((cargo) => MUNICIPAL_CARGO_KEYS.has(cargo as CargoSlug));
}

export function shouldUseEstado(cargos: string[]): boolean {
  return cargos.length === 0 || !cargos.every((cargo) => NATIONAL_CARGO_KEYS.has(cargo as CargoSlug));
}