ALTER TABLE public.screen_logs
  ADD COLUMN IF NOT EXISTS event_code text,
  ADD COLUMN IF NOT EXISTS event_params jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_screen_logs_event_code ON public.screen_logs(event_code);