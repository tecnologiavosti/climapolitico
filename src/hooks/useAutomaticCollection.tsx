import { useEffect } from "react";

// DESATIVADO: A coleta do Twitter agora roda 24/7 no backend via cron job
// (edge function `twitter-nitter-scraper` agendada a cada 1 minuto).
// Mantemos um useEffect vazio para preservar a assinatura de hook estável
// e evitar erros de "hook order" do React durante HMR.
export function useAutomaticCollection() {
  useEffect(() => {
    // no-op
  }, []);
}
