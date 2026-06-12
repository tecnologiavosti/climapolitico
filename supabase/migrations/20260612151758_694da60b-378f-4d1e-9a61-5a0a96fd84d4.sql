
-- Trigger para preencher colunas simplificadas a partir das colunas legadas
CREATE OR REPLACE FUNCTION public.political_events_sync_radar()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.title := COALESCE(NEW.title, NEW.event_name);
  NEW.summary := COALESCE(NEW.summary, NEW.ai_summary_v2, NEW.ai_summary, NEW.description);
  NEW.source_count := GREATEST(
    COALESCE(NEW.source_count, 0),
    COALESCE(NEW.total_sources, 0),
    COALESCE(NEW.publications_count, 0)
  );
  -- Importância = (fontes * 2) + (institucional bonus 6) + (mídia grande bonus 4) + log(social+1)*5
  NEW.importance := GREATEST(
    COALESCE(NEW.importance, 0),
    COALESCE(NEW.importance_score, 0),
    COALESCE(NEW.relevance_score, 0),
    LEAST(
      100,
      COALESCE(NEW.source_count, 0) * 2.0
      + CASE WHEN COALESCE(NEW.institutional_sources,0) > 0 THEN 6 ELSE 0 END
      + CASE WHEN COALESCE(NEW.major_media_sources,0)  >= 2 THEN 4 ELSE 0 END
      + ln(1 + GREATEST(0, COALESCE(NEW.social_score,0))) * 5.0
    )
  );
  NEW.status := COALESCE(NEW.status, 'pending');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_political_events_sync_radar ON public.political_events;
CREATE TRIGGER trg_political_events_sync_radar
  BEFORE INSERT OR UPDATE ON public.political_events
  FOR EACH ROW EXECUTE FUNCTION public.political_events_sync_radar();

-- Backfill com a nova fórmula
UPDATE public.political_events SET updated_at = now();
