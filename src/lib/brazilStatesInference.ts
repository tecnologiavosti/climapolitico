// Inferência heurística de UF e cidade a partir de texto livre (comentário/autor).
// Sem dependências externas. Pensado para PT-BR.
//
// Regras:
//  - UF é detectada por (a) nome completo (com/sem acento), (b) sigla isolada
//    delimitada por borda não alfanumérica (ex.: "moro em SP", "São Paulo - SP"),
//    (c) cidade conhecida que mapeia para sua UF.
//  - Cidade é detectada por correspondência exata (case-insensitive) na lista
//    abaixo (capitais + algumas grandes metrópoles).
//
// Limitação assumida: dados de cidade são esparsos por natureza. Esta
// inferência é best-effort e o componente UI sinaliza claramente
// "Não identificado" quando nada é detectado.

export const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR",
  "PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;
export type UF = typeof UFS[number];

export const UF_NAME: Record<UF, string> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará",
  DF: "Distrito Federal", ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão",
  MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará",
  PB: "Paraíba", PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte", RS: "Rio Grande do Sul", RO: "Rondônia", RR: "Roraima",
  SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

// Nome completo (sem acento, lowercase) → UF
const NAME_TO_UF: Record<string, UF> = {
  "acre":"AC","alagoas":"AL","amapa":"AP","amazonas":"AM","bahia":"BA","ceara":"CE",
  "distrito federal":"DF","espirito santo":"ES","goias":"GO","maranhao":"MA",
  "mato grosso":"MT","mato grosso do sul":"MS","minas gerais":"MG","minas":"MG",
  "para":"PA","paraiba":"PB","parana":"PR","pernambuco":"PE","piaui":"PI",
  "rio de janeiro":"RJ","rio grande do norte":"RN","rio grande do sul":"RS",
  "rondonia":"RO","roraima":"RR","santa catarina":"SC","sao paulo":"SP",
  "sergipe":"SE","tocantins":"TO",
};

// Cidade (sem acento, lowercase) → UF
export const CITY_TO_UF: Record<string, UF> = {
  // Capitais
  "rio branco":"AC","maceio":"AL","macapa":"AP","manaus":"AM","salvador":"BA",
  "fortaleza":"CE","brasilia":"DF","vitoria":"ES","goiania":"GO","sao luis":"MA",
  "cuiaba":"MT","campo grande":"MS","belo horizonte":"MG","belem":"PA",
  "joao pessoa":"PB","curitiba":"PR","recife":"PE","teresina":"PI",
  "rio de janeiro":"RJ","natal":"RN","porto alegre":"RS","porto velho":"RO",
  "boa vista":"RR","florianopolis":"SC","sao paulo":"SP","aracaju":"SE","palmas":"TO",
  // Outras metrópoles relevantes
  "campinas":"SP","guarulhos":"SP","santos":"SP","sorocaba":"SP","ribeirao preto":"SP",
  "sao bernardo do campo":"SP","santo andre":"SP","osasco":"SP","sao jose dos campos":"SP",
  "niteroi":"RJ","duque de caxias":"RJ","nova iguacu":"RJ","sao goncalo":"RJ",
  "uberlandia":"MG","contagem":"MG","juiz de fora":"MG","betim":"MG","montes claros":"MG",
  "londrina":"PR","maringa":"PR","foz do iguacu":"PR","ponta grossa":"PR",
  "caxias do sul":"RS","pelotas":"RS","canoas":"RS","santa maria":"RS",
  "joinville":"SC","blumenau":"SC","chapeco":"SC","itajai":"SC",
  "feira de santana":"BA","ilheus":"BA","vitoria da conquista":"BA",
  "caruaru":"PE","olinda":"PE","jaboatao dos guararapes":"PE","petrolina":"PE",
  "anapolis":"GO","aparecida de goiania":"GO",
  "varzea grande":"MT",
  "ananindeua":"PA","santarem":"PA",
  "imperatriz":"MA",
  "mossoro":"RN",
  "campina grande":"PB",
  "vila velha":"ES","serra":"ES","cariacica":"ES",
};

// Remove acento e baixa caixa
const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// Detecção de sigla isolada: "SP", " SP ", "- SP", "/SP", "(RJ)" etc.
function detectUFSigla(text: string): UF | null {
  // \b funciona em ASCII; usamos lookarounds com não-letra
  const m = text.match(/(?:^|[^A-Za-zÀ-ú])([A-Z]{2})(?=$|[^A-Za-zÀ-ú])/g);
  if (!m) return null;
  for (const raw of m) {
    const code = raw.replace(/[^A-Z]/g, "") as UF;
    if ((UFS as readonly string[]).includes(code)) return code;
  }
  return null;
}

/**
 * Tenta inferir UF + cidade a partir do texto.
 * Retorna { uf, city } onde ambos podem ser null.
 */
export function inferLocation(
  rawText: string | null | undefined,
  rawAuthor: string | null | undefined
): { uf: UF | null; city: string | null } {
  const original = `${rawText ?? ""}\n${rawAuthor ?? ""}`;
  if (!original.trim()) return { uf: null, city: null };

  const lower = norm(original);

  // 1) cidade conhecida (mais informativo) — tenta as mais longas primeiro
  const cityNames = Object.keys(CITY_TO_UF).sort((a, b) => b.length - a.length);
  let foundCity: string | null = null;
  let cityUF: UF | null = null;
  for (const c of cityNames) {
    // borda: não pode estar colado a letra
    const re = new RegExp(`(?:^|[^a-z0-9])${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
    if (re.test(lower)) {
      foundCity = c.replace(/\b\w/g, (m) => m.toUpperCase());
      cityUF = CITY_TO_UF[c];
      break;
    }
  }

  // 2) nome completo de UF
  let nameUF: UF | null = null;
  const ufNames = Object.keys(NAME_TO_UF).sort((a, b) => b.length - a.length);
  for (const n of ufNames) {
    const re = new RegExp(`(?:^|[^a-z0-9])${n}(?:$|[^a-z0-9])`);
    if (re.test(lower)) {
      nameUF = NAME_TO_UF[n];
      break;
    }
  }

  // 3) sigla isolada (no texto original, preservando maiúsculas)
  const siglaUF = detectUFSigla(original);

  const uf = cityUF ?? nameUF ?? siglaUF;
  return { uf, city: foundCity };
}
