// Lista oficial de partidos políticos brasileiros (TSE).
// Fonte única — não fazer fetch/API. Usado em todos os selects/autocompletes de partido.

export type BrazilianParty = {
  sigla: string;
  nome: string;
  numero: number;
};

export const BRAZILIAN_PARTIES: BrazilianParty[] = [
  { sigla: "MDB", nome: "Movimento Democrático Brasileiro", numero: 15 },
  { sigla: "PDT", nome: "Partido Democrático Trabalhista", numero: 12 },
  { sigla: "PT", nome: "Partido dos Trabalhadores", numero: 13 },
  { sigla: "PCdoB", nome: "Partido Comunista do Brasil", numero: 65 },
  { sigla: "PSB", nome: "Partido Socialista Brasileiro", numero: 40 },
  { sigla: "PSDB", nome: "Partido da Social Democracia Brasileira", numero: 45 },
  { sigla: "AGIR", nome: "AGIR", numero: 36 },
  { sigla: "MOBILIZA", nome: "Mobilização Nacional", numero: 33 },
  { sigla: "CIDADANIA", nome: "Cidadania", numero: 23 },
  { sigla: "PV", nome: "Partido Verde", numero: 43 },
  { sigla: "AVANTE", nome: "Avante", numero: 70 },
  { sigla: "PP", nome: "Progressistas", numero: 11 },
  { sigla: "PSTU", nome: "Partido Socialista dos Trabalhadores Unificado", numero: 16 },
  { sigla: "PCB", nome: "Partido Comunista Brasileiro", numero: 21 },
  { sigla: "PRTB", nome: "Partido Renovador Trabalhista Brasileiro", numero: 28 },
  { sigla: "DC", nome: "Democracia Cristã", numero: 27 },
  { sigla: "PCO", nome: "Partido da Causa Operária", numero: 29 },
  { sigla: "PODE", nome: "Podemos", numero: 20 },
  { sigla: "REPUBLICANOS", nome: "Republicanos", numero: 10 },
  { sigla: "PSOL", nome: "Partido Socialismo e Liberdade", numero: 50 },
  { sigla: "PL", nome: "Partido Liberal", numero: 22 },
  { sigla: "PSD", nome: "Partido Social Democrático", numero: 55 },
  { sigla: "SOLIDARIEDADE", nome: "Solidariedade", numero: 77 },
  { sigla: "NOVO", nome: "Partido Novo", numero: 30 },
  { sigla: "REDE", nome: "Rede Sustentabilidade", numero: 18 },
  { sigla: "DEMOCRATA", nome: "Democrata", numero: 35 },
  { sigla: "UP", nome: "Unidade Popular", numero: 80 },
  { sigla: "UNIÃO", nome: "União Brasil", numero: 44 },
  { sigla: "PRD", nome: "Partido Renovação Democrática", numero: 25 },
  { sigla: "MISSÃO", nome: "Partido Missão", numero: 14 },
];

// Chips de acesso rápido (partidos com mais representatividade).
export const POPULAR_PARTY_SIGLAS = [
  "PT", "PL", "MDB", "UNIÃO", "PSD", "PSB", "REPUBLICANOS", "PP", "PSDB", "NOVO",
];

const SIGLA_INDEX = new Map(BRAZILIAN_PARTIES.map((p) => [p.sigla.toUpperCase(), p]));

export function findPartyBySigla(sigla: string | null | undefined): BrazilianParty | null {
  if (!sigla) return null;
  return SIGLA_INDEX.get(sigla.toUpperCase()) ?? null;
}

/** Busca por sigla, nome completo ou número. */
export function searchParties(query: string): BrazilianParty[] {
  const q = query.trim().toLowerCase();
  if (!q) return BRAZILIAN_PARTIES;
  return BRAZILIAN_PARTIES.filter((p) =>
    p.sigla.toLowerCase().includes(q) ||
    p.nome.toLowerCase().includes(q) ||
    String(p.numero) === q ||
    String(p.numero).startsWith(q)
  );
}
