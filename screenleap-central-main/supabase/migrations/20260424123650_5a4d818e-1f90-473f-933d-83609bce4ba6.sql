-- Auto-delete channel blocks whose end date passed more than 30 days ago.
-- Playback history (playback_logs) is a separate table and is NOT affected.
CREATE OR REPLACE FUNCTION public.auto_delete_old_expired_channel_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  affected integer := 0;
BEGIN
  WITH del AS (
    DELETE FROM public.channel_blocks
    WHERE
      (block_type = 'calendar'
        AND end_at IS NOT NULL
        AND end_at < now() - interval '30 days')
      OR
      (block_type = 'weekly'
        AND effective_to IS NOT NULL
        AND effective_to < ((now() AT TIME ZONE 'UTC')::date - 30))
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM del;

  IF affected > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, action, action_code, category, target_type, target_name, detail, action_params
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'auto_delete_old_expired_channel_blocks',
      'SCHEDULE_AUTO_DELETED',
      'schedule',
      'channel_blocks',
      'retention_30d',
      format('Auto-deleted %s expired schedule block(s) older than 30 days', affected),
      jsonb_build_object('deleted', affected, 'retention_days', 30)
    );
  END IF;

  RETURN affected;
END;
$$;

-- Schedule it to run daily at 03:15 UTC (alongside the hourly disable job).
DO $$
BEGIN
  PERFORM cron.unschedule('auto-delete-old-expired-channel-blocks');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'auto-delete-old-expired-channel-blocks',
  '15 3 * * *',
  $$ SELECT public.auto_delete_old_expired_channel_blocks(); $$
);