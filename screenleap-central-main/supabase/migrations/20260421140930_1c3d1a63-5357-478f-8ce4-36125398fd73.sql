ALTER TABLE public.smart_trigger_logs
  ADD COLUMN IF NOT EXISTS debug_id text;

CREATE INDEX IF NOT EXISTS idx_smart_trigger_logs_debug_id
  ON public.smart_trigger_logs (debug_id)
  WHERE debug_id IS NOT NULL;