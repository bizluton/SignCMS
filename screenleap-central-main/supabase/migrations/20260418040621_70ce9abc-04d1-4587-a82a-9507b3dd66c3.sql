ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS action_code text,
  ADD COLUMN IF NOT EXISTS action_params jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_activity_logs_action_code
  ON public.activity_logs (action_code);