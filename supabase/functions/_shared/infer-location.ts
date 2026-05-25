// Inferência server-side de city/state (UF) a partir de texto livre.
// Dicionário alinhado com `enrich-interactions-location` para garantir consistência.

export const UF_SET = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI",
  "RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

export const CITY_TO_UF: Record<string, string> = {
  "rio branco":"AC","maceio":"AL","macapa":"AP","manaus":"AM","salvador":"BA","fortaleza":"CE",
  "brasilia":"DF","vitoria":"ES","goiania":"GO","sao luis":"MA","cuiaba":"MT","campo grande":"MS",
  "belo horizonte":"MG","belem":"PA","joao pessoa":"PB","curitiba":"PR","recife":"PE","teresina":"PI",
  "rio de janeiro":"RJ","natal":"RN","porto alegre":"RS","porto velho":"RO","boa vista":"RR",
  "florianopolis":"SC","sao paulo":"SP","aracaju":"SE","palmas":"TO",
  "campinas":"SP","guarulhos":"SP","santos":"SP","sorocaba":"SP","ribeirao preto":"SP",
  "santo andre":"SP","osasco":"SP","sao bernardo do campo":"SP","sao jose dos campos":"SP",
  "niteroi":"RJ","duque de caxias":"RJ","nova iguacu":"RJ","sao goncalo":"RJ","petropolis":"RJ",
  "uberlandia":"MG","contagem":"MG","juiz de fora":"MG","betim":"MG","montes claros":"MG","uberaba":"MG",
  "londrina":"PR","maringa":"PR","foz do iguacu":"PR","ponta grossa":"PR","cascavel":"PR",
  "caxias do sul":"RS","pelotas":"RS","canoas":"RS","santa maria":"RS","gravatai":"RS",
  "joinville":"SC","blumenau":"SC","chapeco":"SC","itajai":"SC","sao jose":"SC",
  "feira de santana":"BA","ilheus":"BA","vitoria da conquista":"BA","camacari":"BA",
  "caruaru":"PE","olinda":"PE","jaboatao dos guararapes":"PE","petrolina":"PE",
  "anapolis":"GO","aparecida de goiania":"GO","rio verde":"GO",
  "imperatriz":"MA","caxias":"MA",
  "parnaiba":"PI",
  "vila velha":"ES","serra":"ES","cariacica":"ES",
  "ananindeua":"PA","santarem":"PA",
  "varzea grande":"MT","rondonopolis":"MT","sinop":"MT",
  "dourados":"MS","tres lagoas":"MS",
  "mossoro":"RN","parnamirim":"RN",
  "ipatinga":"MG","governador valadares":"MG",
};

const UF_TO_REGION: Record<string, string> = {
  AC:"Norte", AM:"Norte", AP:"Norte", PA:"Norte", RO:"Norte", RR:"Norte", TO:"Norte",
  AL:"Nordeste", BA:"Nordeste", CE:"Nordeste", MA:"Nordeste", PB:"Nordeste",
  PE:"Nordeste", PI:"Nordeste", RN:"Nordeste", SE:"Nordeste",
  DF:"Centro-Oeste", GO:"Centro-Oeste", MT:"Centro-Oeste", MS:"Centro-Oeste",
  ES:"Sudeste", MG:"Sudeste", RJ:"Sudeste", SP:"Sudeste",
  PR:"Sul", RS:"Sul", SC:"Sul",
};

function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export interface InferredLocation {
  city: string | null;
  state: string | null;
  region: string | null;
}

/** Infere city/state/region a partir de texto livre (comentário + autor). */
export function inferLocation(...texts: (string | null | undefined)[]): InferredLocation {
  const t = ` ${norm(texts.filter(Boolean).join(" "))} `;
  if (t.trim().length === 0) return { city: null, state: null, region: null };

  // 1. Cidade conhecida
  for (const [city, uf] of Object.entries(CITY_TO_UF)) {
    if (
      t.includes(` ${city} `) || t.includes(` ${city},`) ||
      t.includes(` ${city}/`) || t.includes(`-${city}`)
    ) {
      return { city, state: uf, region: UF_TO_REGION[uf] ?? null };
    }
  }

  // 2. Sigla UF isolada
  const m = t.match(/[^a-z0-9]([a-z]{2})[^a-z0-9]/gi);
  if (m) {
    for (const tok of m) {
      const sig = tok.replace(/[^a-z]/gi, "").toUpperCase();
      if (UF_SET.has(sig)) {
        return { city: null, state: sig, region: UF_TO_REGION[sig] ?? null };
      }
    }
  }

  return { city: null, state: null, region: null };
}

/** Aplica inferLocation a um registro pronto pra insert, sem sobrescrever city/state existentes. */
export function enrichRecordLocation<T extends Record<string, any>>(rec: T): T {
  if (rec.city && rec.state) return rec;
  const sources: (string | null | undefined)[] = [
    rec.comment_text, rec.comment_author, rec.author_profile_url, rec.post_title,
  ];
  const loc = inferLocation(...sources);
  if (!rec.city && loc.city) rec.city = loc.city;
  if (!rec.state && loc.state) rec.state = loc.state;
  if (!rec.region && loc.region) rec.region = loc.region;
  return rec;
}
