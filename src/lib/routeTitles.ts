/** Mapa central de títulos amigáveis em português para todas as rotas internas. */
export const ROUTE_TITLES: Record<string, string> = {
  dashboard: "Painel Principal",
  overview: "Visão Geral",
  candidates: "Candidatos",
  "candidates-catalog": "Catálogo de Candidatos",
  "candidate-summary": "Resumo do Candidato",
  "candidate-comparison": "Comparar Candidatos",
  "candidate-ranking": "Ranking de Candidatos",
  ranking: "Ranking",
  analytics: "Análises",
  "analytics-advanced": "Análises Avançadas",
  "ai-insights": "Insights da IA",
  "rejection-analysis": "Análise de Rejeição",
  "narrative-recommendations": "Recomendações de Narrativa",
  "radar-politico": "Radar Político",
  "radar-desinformacao": "Radar de Desinformação",
  "regional-analysis": "Análise Regional",
  "historical-comparison": "Comparativo Histórico",
  "network-view": "Visão por Rede",
  "social-feeds": "Feeds Sociais",
  "real-time-monitor": "Monitor em Tempo Real",
  realtime: "Tempo Real",
  "realtime-monitor": "Monitor em Tempo Real",
  "collection-status": "Status da Coleta",
  "brand24-collector": "Coletor Brand24",
  "data-collection-methodology": "Metodologia de Coleta",
  "data-enrichment": "Enriquecimento de Dados",
  "data-diagnostics": "Diagnóstico de Dados",
  "collector-health": "Saúde dos Coletores",
  "system-health": "Saúde do Sistema",
  observability: "Observabilidade",
  operations: "Operações",
  slo: "SLOs",
  "worker-tokens": "Tokens de Worker",
  "tenant-analytics": "Análise de Tenants",
  settings: "Configurações",
  notifications: "Notificações",
  admin: "Administração",
  blog: "Blog",
  mentions: "Menções",
  sentiment: "Sentimento",
  alerts: "Alertas",
  subscription: "Assinatura",
};

/** Retorna título amigável para a última parte do pathname atual. */
export function friendlyRouteTitle(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || "dashboard";
  return ROUTE_TITLES[last] ?? ROUTE_TITLES[parts[0]] ?? "Painel";
}
