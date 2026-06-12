
-- Radar Político: simplificação do schema
ALTER TABLE public.political_events
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS source_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS importance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';

-- Backfill (one-time) a partir das colunas legadas
UPDATE public.political_events
   SET title       = COALESCE(title, event_name),
       summary     = COALESCE(summary, ai_summary_v2, ai_summary, description),
       source_count= GREATEST(COALESCE(source_count,0), COALESCE(total_sources,0), COALESCE(publications_count,0)),
       importance  = GREATEST(COALESCE(importance,0),   COALESCE(importance_score,0), COALESCE(relevance_score,0))
 WHERE title IS NULL OR source_count = 0 OR importance = 0 OR summary IS NULL;

-- Índices para a UI nova
CREATE INDEX IF NOT EXISTS idx_political_events_candidate_date
  ON public.political_events (candidate_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_political_events_importance
  ON public.political_events (importance DESC);
CREATE INDEX IF NOT EXISTS idx_event_sources_event
  ON public.event_sources (event_id);
