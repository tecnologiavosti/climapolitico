CREATE INDEX IF NOT EXISTS radar_job_events_job_importance_idx
ON public.radar_job_events (job_id, importance DESC, event_date DESC NULLS LAST);