const POLITICAL_TERMS = [
  "politica", "politico", "politicos", "eleicao", "eleicoes", "eleitoral", "campanha", "candidato", "candidata", "candidatura",
  "presidente", "presidencia", "governador", "governadora", "senador", "senadora", "deputado", "deputada", "prefeito", "prefeita",
  "vereador", "vereadora", "ministro", "ministra", "governo", "planalto", "congresso", "senado", "camara", "assembleia",
  "stf", "tse", "tcu", "pgr", "agu", "tribunal", "supremo", "partido", "coligacao", "federacao", "mandato", "posse",
  "debate", "sabatina", "entrevista politica", "pronunciamento", "coletiva", "agenda publica", "comicio", "votacao", "plenario",
  "comissao", "cpi", "projeto de lei", "pec", "medida provisoria", "reforma tributaria", "orcamento", "imposto",
  "seguranca publica", "saude publica", "educacao publica", "prefeitura", "governo federal", "governo estadual",
  "pt", "pl", "mdb", "psdb", "psd", "psol", "pdt", "psb", "pp", "republicanos", "uniao brasil", "novo", "podemos",
  "lula", "bolsonaro", "tarcisio", "zema", "caiado", "haddad", "dilma", "rousseff", "alckmin", "moraes", "barroso", "dino",
  "lira", "pacheco", "alcolumbre", "nikolas", "boulos", "marcal",
];

const INVALID_TERMS = [
  "danilo gentili", "the noite", "tve bahia", "turma da monica", "official mv", "official music", "music video", "clipe oficial",
  "videoclipe", "lyrics", "karaoke", "gmm grammy", "white music", "novela", "bbb", "big brother", "reality", "fazenda",
  "masterchef", "carnaval", "samba", "funk", "sertanejo", "futebol", "flamengo", "corinthians", "palmeiras", "vasco",
  "santos fc", "sao paulo fc", "gremio", "cruzeiro", "botafogo", "neymar", "cristiano ronaldo", "messi", "mbappe",
  "vini jr", "ufc", "mma", "formula 1", "nba", "netflix", "disney", "prime video", "hbo", "spotify", "trailer",
  "teaser", "filme", "serie", "temporada", "episodio", "gameplay", "minecraft", "free fire", "fortnite", "receita",
  "culinaria", "restaurante", "humor", "stand up", "comediante", "variedades", "fofoca", "celebridade", "shorts funny",
  "part2 #shorts", "short videos", "meme", "memes", "macarrao", "macarrão", "primeira mulher presidente", "criou o pix",
];

const HISTORICAL_TERMS = [
  "impeachment", "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "ex-presidente", "ex presidenta",
  "pedaladas fiscais", "lava jato", "relembra", "relembre", "retrospectiva", "biografia", "historia de", "história de",
  "na epoca", "na época", "ha anos", "há anos", "arquivo", "primeiro mandato", "segundo mandato",
];

const CURRENT_ACTIVITY_TERMS = [
  "hoje", "agora", "nesta semana", "nesta segunda", "nesta terca", "nesta terça", "nesta quarta", "nesta quinta", "nesta sexta",
  "participa", "participou", "participara", "participará", "discursa", "discursou", "entrevista", "declara", "declarou",
  "afirma", "afirmou", "defende", "defendeu", "critica", "criticou", "anuncia", "anunciou", "recebe", "recebeu",
  "se reune", "se reúne", "reuniu-se", "visita", "viaja", "viajou", "cumpre agenda", "coletiva", "pronunciamento",
];

const OFFICIAL_ACTIVITY_TERMS = [
  "agenda oficial", "reuniao", "reunião", "encontro bilateral", "comitiva", "missao oficial", "missão oficial", "viagem institucional",
  "visita oficial", "cupula", "cúpula", "forum", "fórum", "conferencia", "conferência", "evento do brics", "brics",
  "novo banco de desenvolvimento", "new development bank", "ndb", "banco dos brics", "presidente do banco", "banco multilateral",
  "declaracao oficial", "declaração oficial",
];

export function normalizePoliticalText(value: string | null | undefined): string {
  return (value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasTerm(haystack: string, term: string) {
  const normalized = normalizePoliticalText(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${normalized}([^a-z0-9]|$)`, "i").test(haystack);
}

export function politicalContentVerdict(text: string, candidateName: string) {
  const haystack = normalizePoliticalText(text);
  const candidate = normalizePoliticalText(candidateName);
  const invalidHits = INVALID_TERMS.filter((term) => haystack.includes(normalizePoliticalText(term))).length;
  const historicalHits = HISTORICAL_TERMS.filter((term) => haystack.includes(normalizePoliticalText(term))).length;
  const currentHits = CURRENT_ACTIVITY_TERMS.filter((term) => hasTerm(haystack, term)).length;
  const officialHits = OFFICIAL_ACTIVITY_TERMS.filter((term) => hasTerm(haystack, term)).length;
  const politicalHits = POLITICAL_TERMS.filter((term) => hasTerm(haystack, term)).length;
  let candidateScore = 0;

  if (candidate && haystack.includes(candidate)) {
    candidateScore = 5;
  } else {
    const tokens = candidate.split(/\s+/).filter((token) => token.length >= 4 && !["das", "dos", "de", "da", "do"].includes(token));
    const tokenHits = tokens.filter((token) => hasTerm(haystack, token)).length;
    if (tokens.length >= 2 && tokenHits >= 2) candidateScore = 4;
    else if (tokenHits >= 1 && politicalHits >= 1) candidateScore = 2;
  }

  const currentActivityScore = officialHits >= 1 ? 5 : currentHits >= 1 ? 3 : 0;
  const historicalPenalty = historicalHits > 0 && currentActivityScore === 0 ? 6 : historicalHits;
  const score = Math.max(0, candidateScore + Math.min(politicalHits, 4) + currentActivityScore - invalidHits * 5 - historicalPenalty);
  return {
    score,
    isPolitical: candidateScore > 0 && currentActivityScore > 0 && invalidHits === 0 && score >= 5 && haystack.trim().length >= 8,
    invalidHits,
    historicalHits,
    currentHits,
    officialHits,
    politicalHits,
  };
}

export function isPoliticalCandidateContent(text: string, candidateName: string): boolean {
  return politicalContentVerdict(text, candidateName).isPolitical;
}