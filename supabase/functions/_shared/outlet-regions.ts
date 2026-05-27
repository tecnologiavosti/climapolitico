// Mapping of Brazilian news/media outlets to their primary region.
// Used to infer regional distribution of external publications when explicit
// geo-tags are absent.

export type Region = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul" | "Nacional" | "Internacional";

interface OutletInfo {
  name: string;
  region: Region;
  reachWeight: number; // 1..10 — used for "estimated reach" weighting
  domains: string[];
}

export const OUTLETS: OutletInfo[] = [
  // Nacional (alcance amplo, baseados em SP/RJ)
  { name: "G1", region: "Nacional", reachWeight: 10, domains: ["g1.globo.com", "globo.com"] },
  { name: "CNN Brasil", region: "Nacional", reachWeight: 9, domains: ["cnnbrasil.com.br"] },
  { name: "UOL", region: "Nacional", reachWeight: 10, domains: ["uol.com.br", "noticias.uol.com.br"] },
  { name: "Folha de S.Paulo", region: "Sudeste", reachWeight: 9, domains: ["folha.uol.com.br", "www1.folha.uol.com.br"] },
  { name: "Estadão", region: "Sudeste", reachWeight: 9, domains: ["estadao.com.br"] },
  { name: "Veja", region: "Nacional", reachWeight: 8, domains: ["veja.abril.com.br"] },
  { name: "Poder360", region: "Centro-Oeste", reachWeight: 8, domains: ["poder360.com.br"] },
  { name: "Metrópoles", region: "Centro-Oeste", reachWeight: 9, domains: ["metropoles.com"] },
  { name: "Brasil 247", region: "Nacional", reachWeight: 7, domains: ["brasil247.com"] },
  { name: "Agência Brasil", region: "Nacional", reachWeight: 7, domains: ["agenciabrasil.ebc.com.br"] },
  { name: "Carta Capital", region: "Sudeste", reachWeight: 6, domains: ["cartacapital.com.br"] },
  { name: "Jovem Pan", region: "Sudeste", reachWeight: 8, domains: ["jovempan.com.br"] },
  { name: "Band", region: "Sudeste", reachWeight: 8, domains: ["band.uol.com.br", "noticias.band.uol.com.br"] },
  { name: "SBT", region: "Sudeste", reachWeight: 8, domains: ["sbtnews.sbt.com.br"] },
  { name: "Record", region: "Sudeste", reachWeight: 8, domains: ["recordtv.r7.com", "r7.com"] },
  { name: "Terra", region: "Nacional", reachWeight: 7, domains: ["terra.com.br"] },
  { name: "IG", region: "Nacional", reachWeight: 5, domains: ["ig.com.br", "ultimosegundo.ig.com.br"] },
  // Nordeste
  { name: "Diário de Pernambuco", region: "Nordeste", reachWeight: 5, domains: ["diariodepernambuco.com.br"] },
  { name: "JC Online", region: "Nordeste", reachWeight: 5, domains: ["jconline.ne10.uol.com.br"] },
  { name: "Correio*", region: "Nordeste", reachWeight: 5, domains: ["correio24horas.com.br"] },
  { name: "A Tarde", region: "Nordeste", reachWeight: 5, domains: ["atarde.com.br"] },
  { name: "Diário do Nordeste", region: "Nordeste", reachWeight: 6, domains: ["diariodonordeste.verdesmares.com.br"] },
  { name: "Tribuna do Norte", region: "Nordeste", reachWeight: 4, domains: ["tribunadonorte.com.br"] },
  { name: "Cidade Verde", region: "Nordeste", reachWeight: 4, domains: ["cidadeverde.com"] },
  // Sul
  { name: "Gaúcha ZH", region: "Sul", reachWeight: 6, domains: ["gauchazh.clicrbs.com.br"] },
  { name: "Gazeta do Povo", region: "Sul", reachWeight: 6, domains: ["gazetadopovo.com.br"] },
  { name: "NSC Total", region: "Sul", reachWeight: 5, domains: ["nsctotal.com.br"] },
  // Norte
  { name: "Diário do Pará", region: "Norte", reachWeight: 4, domains: ["diariodopara.com.br"] },
  { name: "Amazonas Atual", region: "Norte", reachWeight: 3, domains: ["amazonasatual.com.br"] },
  { name: "A Crítica", region: "Norte", reachWeight: 4, domains: ["acritica.com"] },
  // Centro-Oeste
  { name: "Correio Braziliense", region: "Centro-Oeste", reachWeight: 7, domains: ["correiobraziliense.com.br"] },
  { name: "Midia News", region: "Centro-Oeste", reachWeight: 4, domains: ["midianews.com.br"] },
  // Internacional
  { name: "Reuters", region: "Internacional", reachWeight: 8, domains: ["reuters.com"] },
  { name: "BBC", region: "Internacional", reachWeight: 8, domains: ["bbc.com", "bbc.co.uk"] },
  { name: "AP", region: "Internacional", reachWeight: 7, domains: ["apnews.com"] },
  { name: "AFP", region: "Internacional", reachWeight: 7, domains: ["afp.com"] },
  // Social / Video
  { name: "YouTube", region: "Nacional", reachWeight: 6, domains: ["youtube.com", "youtu.be"] },
  { name: "X / Twitter", region: "Nacional", reachWeight: 6, domains: ["twitter.com", "x.com"] },
  { name: "Instagram", region: "Nacional", reachWeight: 6, domains: ["instagram.com"] },
];

const DOMAIN_INDEX: Record<string, OutletInfo> = (() => {
  const idx: Record<string, OutletInfo> = {};
  for (const o of OUTLETS) for (const d of o.domains) idx[d] = o;
  return idx;
})();

export function identifyOutlet(url: string): OutletInfo | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (DOMAIN_INDEX[host]) return DOMAIN_INDEX[host];
    // try parent domain match (subdomains)
    const parts = host.split(".");
    for (let i = 1; i < parts.length; i++) {
      const sub = parts.slice(i).join(".");
      if (DOMAIN_INDEX[sub]) return DOMAIN_INDEX[sub];
    }
    // partial match
    for (const d in DOMAIN_INDEX) if (host.endsWith(d) || host.includes(d)) return DOMAIN_INDEX[d];
    return null;
  } catch {
    return null;
  }
}

// Estimated reach based on outlet weight (rough heuristic, in "people")
export function estimateReach(weight: number): number {
  // weight 10 ≈ 5M, weight 1 ≈ 10k (log-ish)
  return Math.round(10000 * Math.pow(2.2, weight));
}
