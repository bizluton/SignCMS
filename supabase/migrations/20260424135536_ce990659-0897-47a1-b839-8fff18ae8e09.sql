ALTER PUBLICATION supabase_realtime ADD TABLE public.schedule_cleanup_settings;
ALTER TABLE public.schedule_cleanup_settings REPLICA IDENTITY FULL;