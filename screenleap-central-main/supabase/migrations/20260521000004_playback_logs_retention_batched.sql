-- Replace the unbatched 90-day DELETE on playback_logs with a chunked
-- equivalent. The single-statement DELETE in 20260506000003 takes a wide
-- lock and (at the projected ~430M rows/month) can stall writes for minutes.
--
-- This function deletes in batches of 10_000 with a tiny pause between
-- batches, looping until either nothing's left or a per-run cap is reached
-- (defends the daily job from looping forever if the table somehow has
-- months of backlog).
--
-- Proper long-term fix is monthly partitioning + DROP PARTITION, but
-- partitioning is a heavier change; until then this is the safer DELETE.

CREATE OR REPLACE FUNCTION public.purge_playback_logs_batched(
  p_older_than interval DEFAULT INTERVAL '90 days',
  p_batch_size int      DEFAULT 10000,
  p_max_batches int     DEFAULT 500     -- soft cap: up to 5M rows per run
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz := now() - p_older_than;
  v_batch  int;
  v_total  bigint := 0;
  i        int := 0;
BEGIN
  LOOP
    EXIT WHEN i >= p_max_batches;

    WITH victims AS (
      SELECT id
        FROM public.playback_logs
       WHERE played_at < v_cutoff
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
    )
    DELETE FROM public.playback_logs
     WHERE id IN (SELECT id FROM victims);
    GET DIAGNOSTICS v_batch = ROW_COUNT;

    v_total := v_total + v_batch;
    EXIT WHEN v_batch = 0;

    -- Small breather so concurrent INSERTs can make progress.
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.purge_playback_logs_batched(interval, int, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_playback_logs_batched(interval, int, int) TO service_role;

-- Re-schedule the cron to call the batched version.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('playback-logs-retention');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'playback-logs-retention',
      '0 3 * * *',
      $sql$SELECT public.purge_playback_logs_batched()$sql$
    );
    RAISE NOTICE 'playback-logs-retention rescheduled (batched).';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule retention externally.';
  END IF;
END
$do$;
