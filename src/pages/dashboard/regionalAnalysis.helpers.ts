// Pure helpers extraídos de RegionalAnalysis.tsx para permitir testes unitários
// e prevenir regressões nos cálculos de métricas regionais.
import {
  Globe,
  Instagram,
  Youtube,
  Facebook,
  Twitter,
  Music2,
  MessageSquare,
  Newspaper,
} from "lucide-react";
import type { ComponentType } from "react";

export type RegionLabel = "Norte" | "Nordeste" | "Centro-Oeste" | "Sudeste" | "Sul";
export const REGIONS: RegionLabel[] = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

export interface Metrics {
  total: number;
  pos: number;
  neg: number;
  neu: number;
  acceptance: number;
  rejection: number;
  engagement: number;
}

export const EMPTY_METRICS: Metrics = {
  total: 0,
  pos: 0,
  neg: 0,
  neu: 0,
  acceptance: 0,
  rejection: 0,
  engagement: 0,
};

export const ALL_NETWORKS_VALUE = "__all__";

export interface NetworkCfg {
  values: string[];
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

export const NETWORKS: NetworkCfg[] = [
  { values: ["YouTube", "youtube"], label: "YouTube", Icon: Youtube },
  { values: ["Twitter/X", "twitter", "Twitter", "x"], label: "Twitter/X", Icon: Twitter },
  { values: ["Instagram", "instagram"], label: "Instagram", Icon: Instagram },
  { values: ["TikTok", "tiktok"], label: "TikTok", Icon: Music2 },
  { values: ["Facebook", "facebook"], label: "Facebook", Icon: Facebook },
  { values: ["google_news", "Google News", "news"], label: "Notícias", Icon: Newspaper },
  { values: ["Reddit", "reddit"], label: "Reddit", Icon: Globe },
  { values: ["Telegram", "telegram"], label: "Telegram", Icon: MessageSquare },
  { values: ["LinkedIn", "linkedin"], label: "LinkedIn", Icon: Globe },
];

export function colorByAcceptance(acc: number, total: number): string {
  if (total < 10) return "hsl(var(--muted))";
  if (acc > 65) return "hsl(142, 70%, 45%)";
  if (acc >= 35) return "hsl(45, 95%, 55%)";
  return "hsl(0, 75%, 55%)";
}

export function computeMetrics(
  rows: {
    sentiment_label: string | null;
    likes_count: number | null;
    replies_count: number | null;
    shares_count: number | null;
  }[]
): Metrics {
  const total = rows.length;
  if (!total) return { ...EMPTY_METRICS };
  let pos = 0,
    neg = 0,
    neu = 0,
    eng = 0;
  for (const r of rows) {
    const s = (r.sentiment_label || "").toLowerCase();
    if (s === "positive" || s === "positivo") pos++;
    else if (s === "negative" || s === "negativo") neg++;
    else neu++;
    eng += (r.likes_count || 0) + (r.replies_count || 0) + (r.shares_count || 0);
  }
  // Aceitação/rejeição calculadas sobre menções com opinião expressa (pos+neg).
  // Neutros são excluídos do denominador para evitar diluição artificial — sem isso,
  // regiões com muito conteúdo neutro/factual ficam com aceitação ~10% mesmo
  // quando o sentimento positivo domina entre quem opinou.
  const opinionated = pos + neg;
  const acceptance = opinionated > 0 ? Math.round((pos / opinionated) * 1000) / 10 : 0;
  const rejection = opinionated > 0 ? Math.round((neg / opinionated) * 1000) / 10 : 0;
  return {
    total,
    pos,
    neg,
    neu,
    acceptance,
    rejection,
    engagement: Math.round((eng / total) * 10) / 10,
  };
}

export const networkLabel = (n: string) =>
  NETWORKS.find((x) => x.label === n || x.values.includes(n))?.label ?? n;

/**
 * Agrupa linhas brutas em métricas por região + total não classificado.
 * Espelha exatamente o pipeline usado em loadMap().
 */
export function groupRowsByRegion<
  T extends {
    region: string | null;
    sentiment_label: string | null;
    likes_count: number | null;
    replies_count: number | null;
    shares_count: number | null;
  },
>(rows: T[]): { mapData: Record<RegionLabel, Metrics>; unclassified: number } {
  const grouped: Record<string, T[]> = {};
  let unclassified = 0;
  for (const r of rows) {
    const reg = (r.region as string) || "";
    if ((REGIONS as string[]).includes(reg)) {
      (grouped[reg] = grouped[reg] || []).push(r);
    } else {
      unclassified++;
    }
  }
  const md = {} as Record<RegionLabel, Metrics>;
  for (const r of REGIONS) md[r] = computeMetrics(grouped[r] ?? []);
  return { mapData: md, unclassified };
}

/**
 * Constrói o breakdown por rede (usado quando filtro = "Todas as redes").
 */
export function buildNetworkBreakdown(
  rows: { social_network: string }[]
): { label: string; total: number }[] {
  const byNet = new Map<string, number>();
  for (const r of rows) {
    const lbl = networkLabel(r.social_network);
    byNet.set(lbl, (byNet.get(lbl) ?? 0) + 1);
  }
  return Array.from(byNet.entries())
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total);
}
