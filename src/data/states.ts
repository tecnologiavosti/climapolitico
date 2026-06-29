export interface State { sigla: string; nome: string; regiao: string }

export const STATES: State[] = [
  { sigla: "AC", nome: "Acre", regiao: "norte" },
  { sigla: "AP", nome: "Amapá", regiao: "norte" },
  { sigla: "AM", nome: "Amazonas", regiao: "norte" },
  { sigla: "PA", nome: "Pará", regiao: "norte" },
  { sigla: "RO", nome: "Rondônia", regiao: "norte" },
  { sigla: "RR", nome: "Roraima", regiao: "norte" },
  { sigla: "TO", nome: "Tocantins", regiao: "norte" },
  { sigla: "AL", nome: "Alagoas", regiao: "nordeste" },
  { sigla: "BA", nome: "Bahia", regiao: "nordeste" },
  { sigla: "CE", nome: "Ceará", regiao: "nordeste" },
  { sigla: "MA", nome: "Maranhão", regiao: "nordeste" },
  { sigla: "PB", nome: "Paraíba", regiao: "nordeste" },
  { sigla: "PE", nome: "Pernambuco", regiao: "nordeste" },
  { sigla: "PI", nome: "Piauí", regiao: "nordeste" },
  { sigla: "RN", nome: "Rio Grande do Norte", regiao: "nordeste" },
  { sigla: "SE", nome: "Sergipe", regiao: "nordeste" },
  { sigla: "DF", nome: "Distrito Federal", regiao: "centro-oeste" },
  { sigla: "GO", nome: "Goiás", regiao: "centro-oeste" },
  { sigla: "MT", nome: "Mato Grosso", regiao: "centro-oeste" },
  { sigla: "MS", nome: "Mato Grosso do Sul", regiao: "centro-oeste" },
  { sigla: "ES", nome: "Espírito Santo", regiao: "sudeste" },
  { sigla: "MG", nome: "Minas Gerais", regiao: "sudeste" },
  { sigla: "RJ", nome: "Rio de Janeiro", regiao: "sudeste" },
  { sigla: "SP", nome: "São Paulo", regiao: "sudeste" },
  { sigla: "PR", nome: "Paraná", regiao: "sul" },
  { sigla: "RS", nome: "Rio Grande do Sul", regiao: "sul" },
  { sigla: "SC", nome: "Santa Catarina", regiao: "sul" },
];

export const STATES_BY_REGION: Record<string, string[]> = STATES.reduce((acc, s) => {
  (acc[s.regiao] ||= []).push(s.sigla);
  return acc;
}, {} as Record<string, string[]>);
