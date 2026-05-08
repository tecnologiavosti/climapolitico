/**
 * Redes coletadas internamente para enriquecimento mas que NÃO devem aparecer
 * em gráficos/painéis públicos (mantemos a coleta rodando no backend).
 */
export const HIDDEN_FROM_CHARTS = ["mastodon", "lemmy", "pinterest", "gdelt"] as const;

export const isHiddenNetwork = (n: string | null | undefined): boolean => {
  if (!n) return false;
  return HIDDEN_FROM_CHARTS.includes(n.toLowerCase() as typeof HIDDEN_FROM_CHARTS[number]);
};

/** Para usar em filtros .not('social_network','in', `(${HIDDEN_NETWORKS_SQL})`) */
export const HIDDEN_NETWORKS_SQL = `(${HIDDEN_FROM_CHARTS.join(",")})`;
