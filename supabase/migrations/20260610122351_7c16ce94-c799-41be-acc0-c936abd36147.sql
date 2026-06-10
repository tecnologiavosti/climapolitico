-- Reset dos contadores de erro inflados pelo bug do orquestrador.
-- Causa raiz: orquestrador marcava o ciclo inteiro como erro quando QUALQUER candidato falhasse,
-- mesmo quando 27 de 28 candidatos coletaram com sucesso. Corrigido em código.
-- Coletores afetados ainda persistem dados normalmente em social_interactions.
UPDATE public.collector_quota_state
SET daily_errors = 0, updated_at = now()
WHERE daily_items_collected > 0
  AND daily_errors >= daily_calls;