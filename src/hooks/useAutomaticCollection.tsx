// DESATIVADO: A coleta do Twitter agora roda 24/7 no backend via cron job
// (edge function `twitter-nitter-scraper` agendada a cada 1 minuto).
// Este hook foi mantido como no-op para compatibilidade com Dashboard.tsx.
export function useAutomaticCollection() {
  // No-op. Coleta automática agora é executada no servidor.
}
