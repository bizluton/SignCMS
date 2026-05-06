-- Automatic retention policy for playback_logs via pg_cron.
-- Runs daily at 03:00 UTC, deletes rows older than 90 days.
--
-- Projection at 10,000 screens / 60-second average dwell:
--   ~167 INSERTs/sec → ~430 million rows/month → ~51 GB/month unmanaged.
--
-- Each partition covers one calendar month so once a partition falls fully
-- outside the 90-day window the DELETE is very fast (partition pruning).
--
-- Requires pg_cron (enabled on Supabase Pro+). On Free/Starter tiers the
-- DO block exits gracefully — schedule via an Edge Function cron trigger.

DO $$
DECLARE
  _sql text := 'DELETE FROM public.playback_logs WHERE played_at < now() - INTERVAL ''90 days''';
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('playback-logs-retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule('playback-logs-retention', '0 3 * * *', _sql);
    RAISE NOTICE 'playback-logs-retention cron job scheduled.';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule retention externally.';
  END IF;
END $$;

-- Index for fast retention deletes on the default (catch-all) partition
CREATE INDEX IF NOT EXISTS idx_playback_logs_played_at
  ON public.playback_logs (played_at);
