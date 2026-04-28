
-- Índice único antiduplicata: mesma rede + candidato + texto normalizado
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_interactions_unique_comment
ON public.social_interactions (
  candidate_id,
  social_network,
  md5(lower(trim(comment_text)))
)
WHERE comment_text IS NOT NULL AND length(trim(comment_text)) > 0;
