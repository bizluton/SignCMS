-- Ensure full row payload on UPDATE for realtime consumers
ALTER TABLE public.delegation_grants REPLICA IDENTITY FULL;

-- Add to supabase_realtime publication if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'delegation_grants'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.delegation_grants';
  END IF;
END $$;