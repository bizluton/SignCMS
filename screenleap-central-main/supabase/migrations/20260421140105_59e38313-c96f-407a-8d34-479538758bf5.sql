ALTER PUBLICATION supabase_realtime ADD TABLE public.smart_trigger_logs;
ALTER TABLE public.smart_trigger_logs REPLICA IDENTITY FULL;