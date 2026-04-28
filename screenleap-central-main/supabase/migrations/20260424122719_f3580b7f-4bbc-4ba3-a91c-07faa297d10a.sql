-- Function: disable expired channel_blocks
CREATE OR REPLACE FUNCTION public.auto_disable_expired_channel_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  WITH upd AS (
    UPDATE public.channel_blocks
       SET enabled = false,
           updated_at = now()
     WHERE enabled = true
       AND (
         (block_type = 'calendar' AND end_at IS NOT NULL AND end_at < now())
         OR
         (block_type = 'weekly' AND effective_to IS NOT NULL AND effective_to < (now() AT TIME ZONE 'UTC')::date)
       )
     RETURNING 1
  )
  SELECT count(*) INTO affected FROM upd;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_disable_expired_channel_blocks() TO authenticated;

-- Run once now to catch any already-expired rows
SELECT public.auto_disable_expired_channel_blocks();

-- Schedule via pg_cron (hourly). Safe to re-run: drop existing job first.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname = 'auto-disable-expired-channel-blocks';

    PERFORM cron.schedule(
      'auto-disable-expired-channel-blocks',
      '0 * * * *',
      $cron$SELECT public.auto_disable_expired_channel_blocks();$cron$
    );
  END IF;
END;
$$;