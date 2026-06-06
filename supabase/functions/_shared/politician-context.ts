// Per-politician contextual collection profiles.
// Each politician has a role-specific set of contexts/topics and trusted sources.
// The collector combines candidate name with these contexts to retrieve
// real political activity (not just name mentions).

export interface PoliticianContext {
  role: string;
  contexts: string[]; // topical search terms (combined with the candidate name)
  outlets: string[]; // trusted outlets to prioritize / query directly
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// Canonical profiles for high-profile politicians.
const PROFILES: Record<string, PoliticianContext> = {
  "dilma rousseff": {
    role: "Presidente do Novo Banco de Desenvolvimento (NDB / Banco dos BRICS)",
    contexts: [
      "BRICS",
      "Novo Banco de Desenvolvimento",
      "NDB",
      "Banco dos BRICS",
      "desenvolvimento internacional",
      "financiamento internacional",
      "infraestrutura",
      "China",
      "Russia",
      "India",
      "Africa do Sul",
      "cupula multilateral",
      "Shanghai",
    ],
    outlets: [
      "reuters.com", "bloomberg.com", "ft.com", "valor.globo.com", "poder360.com.br",
      "cnnbrasil.com.br", "bbc.com", "exame.com", "infomoney.com.br", "agenciabrasil.ebc.com.br",
      "ndb.int", "brics2025.gov.br",
    ],
  },
  "lula": {
    role: "Presidente da Republica",
    contexts: [
      "Presidencia da Republica", "Palacio do Planalto", "governo federal", "ministerios",
      "economia", "relacoes internacionais", "agenda presidencial", "pronunciamento", "decreto",
    ],
    outlets: [
      "g1.globo.com", "valor.globo.com", "poder360.com.br", "cnnbrasil.com.br", "uol.com.br",
      "folha.uol.com.br", "estadao.com.br", "agenciabrasil.ebc.com.br", "gov.br", "reuters.com",
    ],
  },
  "luiz inacio lula da silva": {
    role: "Presidente da Republica",
    contexts: [
      "Presidencia da Republica", "Palacio do Planalto", "governo federal", "ministerios",
      "economia", "relacoes internacionais", "agenda presidencial",
    ],
    outlets: [
      "g1.globo.com", "valor.globo.com", "poder360.com.br", "cnnbrasil.com.br",
      "folha.uol.com.br", "estadao.com.br", "agenciabrasil.ebc.com.br", "gov.br",
    ],
  },
  "flavio bolsonaro": {
    role: "Senador da Republica",
    contexts: [
      "Senado Federal", "Congresso Nacional", "oposicao", "PL", "familia Bolsonaro",
      "CPI", "projeto de lei", "eleicoes",
    ],
    outlets: [
      "senado.leg.br", "poder360.com.br", "cnnbrasil.com.br", "g1.globo.com",
      "folha.uol.com.br", "estadao.com.br", "oantagonista.com.br", "metropoles.com",
    ],
  },
  "jair bolsonaro": {
    role: "Ex-Presidente da Republica",
    contexts: [
      "PL", "inelegibilidade", "TSE", "STF", "atos politicos", "oposicao", "eleicoes",
    ],
    outlets: [
      "poder360.com.br", "cnnbrasil.com.br", "g1.globo.com", "folha.uol.com.br",
      "estadao.com.br", "metropoles.com", "oantagonista.com.br",
    ],
  },
  "tarcisio de freitas": {
    role: "Governador de Sao Paulo",
    contexts: [
      "Governo de Sao Paulo", "Palacio dos Bandeirantes", "Sao Paulo", "infraestrutura",
      "privatizacao", "Sabesp", "seguranca publica SP",
    ],
    outlets: [
      "g1.globo.com", "valor.globo.com", "folha.uol.com.br", "estadao.com.br",
      "poder360.com.br", "saopaulo.sp.gov.br",
    ],
  },
  "ronaldo caiado": {
    role: "Governador de Goias",
    contexts: [
      "Governo de Goias", "Goias", "Uniao Brasil", "seguranca publica GO", "agronegocio",
    ],
    outlets: [
      "g1.globo.com", "poder360.com.br", "cnnbrasil.com.br", "goias.gov.br",
    ],
  },
  "fernando haddad": {
    role: "Ministro da Fazenda",
    contexts: [
      "Ministerio da Fazenda", "politica economica", "arcabouco fiscal", "reforma tributaria",
      "PIB", "inflacao", "Banco Central",
    ],
    outlets: [
      "valor.globo.com", "infomoney.com.br", "exame.com", "poder360.com.br",
      "cnnbrasil.com.br", "reuters.com", "bloomberg.com", "gov.br",
    ],
  },
  "geraldo alckmin": {
    role: "Vice-Presidente da Republica",
    contexts: [
      "Vice-presidencia", "MDIC", "industria", "comercio exterior", "Mercosul",
    ],
    outlets: [
      "valor.globo.com", "poder360.com.br", "g1.globo.com", "agenciabrasil.ebc.com.br",
    ],
  },
};

// Generic profile when the politician is not in the curated list.
const DEFAULT_PROFILE: PoliticianContext = {
  role: "Agente politico",
  contexts: [
    "agenda", "reuniao", "discurso", "entrevista", "coletiva", "viagem oficial",
    "declaracao", "projeto", "votacao", "evento oficial",
  ],
  outlets: [
    "g1.globo.com", "valor.globo.com", "poder360.com.br", "cnnbrasil.com.br",
    "folha.uol.com.br", "estadao.com.br", "agenciabrasil.ebc.com.br", "uol.com.br",
    "metropoles.com", "reuters.com",
  ],
};

export function getPoliticianContext(candidateName: string): PoliticianContext {
  const key = norm(candidateName);
  if (PROFILES[key]) return PROFILES[key];
  // try matching by last/first token (e.g. "dilma", "lula", "haddad")
  for (const [name, profile] of Object.entries(PROFILES)) {
    const tokens = name.split(/\s+/);
    if (tokens.some((t) => t.length >= 4 && key.includes(t))) {
      return profile;
    }
  }
  return DEFAULT_PROFILE;
}

// Build the list of contextual search queries for a candidate.
// Always includes the bare name + name combined with each top context.
export function buildContextualQueries(candidateName: string, max = 8): string[] {
  const profile = getPoliticianContext(candidateName);
  const out = new Set<string>();
  out.add(`"${candidateName}"`);
  for (const ctx of profile.contexts.slice(0, max - 1)) {
    out.add(`"${candidateName}" ${ctx}`);
  }
  return Array.from(out).slice(0, max);
}

export function getTrustedOutlets(candidateName: string): string[] {
  return getPoliticianContext(candidateName).outlets;
}
