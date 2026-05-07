/**
 * ✅ Checklist de Testes — Aba "Análise Regional"
 *
 * Fluxos críticos a cobrir (manual + automatizado):
 *
 *  [A] Troca de candidato
 *      - Selector lista todos os candidatos do usuário
 *      - Mudar candidato dispara loadMap() (novo fetch global)
 *      - Métricas de todas as 5 regiões são recalculadas
 *      - Total não-classificado é atualizado
 *
 *  [B] Troca de rede social
 *      - Opção "Todas as redes" agrega todas as plataformas
 *      - Selecionar rede específica filtra por `social_network IN (values)`
 *      - Breakdown por rede só aparece em "Todas as redes"
 *      - Race-condition: trocas rápidas descartam respostas obsoletas (requestSeqRef)
 *
 *  [C] Clique no mapa SVG
 *      - Cada path de região é clicável e seta `region` no estado
 *      - Região selecionada fica destacada (stroke + classe selected)
 *      - Clique NÃO recarrega o mapa, apenas detalhes (loadRegionDetails)
 *
 *  [D] Clique no ranking lateral
 *      - Lista ordenada por aceitação (asc/desc dependendo da metrica)
 *      - Clicar num item seta a mesma `region` que o mapa
 *      - Item selecionado tem destaque visual
 *
 *  [E] Mudança de região
 *      - KPIs (total, aceitação, rejeição, engajamento) atualizam
 *      - Comentários reais são recarregados (paginados)
 *      - AI Insights só dispara se total ≥ 10 (fallback gracioso se créditos esgotados)
 *      - Cache de insights por chave `candidateId|network|region`
 *
 *  [F] Edge cases
 *      - Sem candidatos: mostra empty state
 *      - Sem dados: métricas zeradas, mapa em cinza muted
 *      - Falha de IA: card de insights mostra fallback, não quebra a UI
 *
 * Os testes abaixo automatizam os pontos mais sensíveis a regressão:
 * cálculos de métricas (A/B/E) e agregação por região/rede (A/B).
 */

import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  colorByAcceptance,
  networkLabel,
  groupRowsByRegion,
  buildNetworkBreakdown,
  EMPTY_METRICS,
  REGIONS,
} from "./regionalAnalysis.helpers";

const row = (over: Partial<Parameters<typeof computeMetrics>[0][number]> = {}) => ({
  sentiment_label: null,
  likes_count: 0,
  replies_count: 0,
  shares_count: 0,
  ...over,
});

describe("computeMetrics", () => {
  it("returns EMPTY_METRICS for empty input", () => {
    expect(computeMetrics([])).toEqual(EMPTY_METRICS);
  });

  it("counts pos/neg/neu across PT and EN labels", () => {
    const m = computeMetrics([
      row({ sentiment_label: "Positivo" }),
      row({ sentiment_label: "positive" }),
      row({ sentiment_label: "Negativo" }),
      row({ sentiment_label: "negative" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: null }),
    ]);
    expect(m.total).toBe(6);
    expect(m.pos).toBe(2);
    expect(m.neg).toBe(2);
    expect(m.neu).toBe(2);
  });

  it("calculates acceptance/rejection over opinionated mentions only (excludes neutrals)", () => {
    // 3 positivos, 1 negativo, 6 neutros => aceitação = 3/(3+1) = 75%
    const m = computeMetrics([
      row({ sentiment_label: "positive" }),
      row({ sentiment_label: "positive" }),
      row({ sentiment_label: "positive" }),
      row({ sentiment_label: "negative" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: "Neutro" }),
    ]);
    expect(m.acceptance).toBe(75);
    expect(m.rejection).toBe(25);
  });

  it("returns 0 acceptance/rejection when only neutrals exist", () => {
    const m = computeMetrics([
      row({ sentiment_label: "Neutro" }),
      row({ sentiment_label: null }),
    ]);
    expect(m.acceptance).toBe(0);
    expect(m.rejection).toBe(0);
  });

  it("sums engagement (likes + replies + shares) and averages", () => {
    const m = computeMetrics([
      row({ likes_count: 10, replies_count: 2, shares_count: 1 }),
      row({ likes_count: 4, replies_count: 0, shares_count: 0 }),
    ]);
    // total engagement = 17, avg = 8.5
    expect(m.engagement).toBe(8.5);
  });
});

describe("colorByAcceptance", () => {
  it("returns muted for low samples (<10 mentions)", () => {
    expect(colorByAcceptance(80, 9)).toContain("muted");
  });
  it("returns green when acceptance > 65", () => {
    expect(colorByAcceptance(70, 100)).toContain("142");
  });
  it("returns yellow for mid acceptance", () => {
    expect(colorByAcceptance(50, 100)).toContain("45");
  });
  it("returns red for low acceptance", () => {
    expect(colorByAcceptance(20, 100)).toContain("0,");
  });
});

describe("networkLabel", () => {
  it("normalizes raw DB values to canonical label", () => {
    expect(networkLabel("youtube")).toBe("YouTube");
    expect(networkLabel("twitter")).toBe("Twitter/X");
    expect(networkLabel("x")).toBe("Twitter/X");
    expect(networkLabel("google_news")).toBe("Notícias");
  });
  it("falls through unknown values", () => {
    expect(networkLabel("MySpace")).toBe("MySpace");
  });
});

describe("groupRowsByRegion", () => {
  it("aggregates per region and counts unclassified", () => {
    const rows = [
      { region: "Sudeste", sentiment_label: "positive", likes_count: 0, replies_count: 0, shares_count: 0 },
      { region: "Sudeste", sentiment_label: "negative", likes_count: 0, replies_count: 0, shares_count: 0 },
      { region: "Nordeste", sentiment_label: "positive", likes_count: 0, replies_count: 0, shares_count: 0 },
      { region: null, sentiment_label: "positive", likes_count: 0, replies_count: 0, shares_count: 0 },
      { region: "Estrangeiro", sentiment_label: "neutro", likes_count: 0, replies_count: 0, shares_count: 0 },
    ];
    const { mapData, unclassified } = groupRowsByRegion(rows);
    expect(mapData.Sudeste.total).toBe(2);
    expect(mapData.Nordeste.total).toBe(1);
    expect(mapData.Norte.total).toBe(0);
    expect(mapData.Sul.total).toBe(0);
    expect(mapData["Centro-Oeste"].total).toBe(0);
    expect(unclassified).toBe(2);
    // Soma classificada + não classificada == total bruto
    const classified = REGIONS.reduce((acc, r) => acc + mapData[r].total, 0);
    expect(classified + unclassified).toBe(rows.length);
  });
});

describe("buildNetworkBreakdown", () => {
  it("groups raw social_network values to canonical labels and sorts desc", () => {
    const rows = [
      { social_network: "youtube" },
      { social_network: "YouTube" },
      { social_network: "twitter" },
      { social_network: "x" },
      { social_network: "Instagram" },
    ];
    const out = buildNetworkBreakdown(rows);
    // Garantir ordenação desc
    expect(out[0].total).toBeGreaterThanOrEqual(out[out.length - 1].total);
    const yt = out.find((x) => x.label === "YouTube")!;
    const tw = out.find((x) => x.label === "Twitter/X")!;
    const ig = out.find((x) => x.label === "Instagram")!;
    expect(yt.total).toBe(2);
    expect(tw.total).toBe(2);
    expect(ig.total).toBe(1);
  });
});
