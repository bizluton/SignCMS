-- TTL cleanup functions and pg_cron schedules for unbounded log tables.
--
-- Four tables grow indefinitely without a retention policy:
--   iot_sensor_readings  – time-series sensor data  → 90-day default
--   screen_logs          – device event log          → 90-day default
--   playback_logs        – media playback records    → 90-day default
--   smart_trigger_logs   – trigger execution log     → 30-day default
--
-- All functions are SECURITY DEFINER so pg_cron can call them from the
-- postgres role without bypassing RLS in user-facing contexts.
-- Each function returns the number of rows deleted and records the run in
-- activity_logs for auditability.
--
-- Scheduled cron jobs run at 03:30 UTC daily (alongside the existing
-- schedule-and-media-cleanup job that runs at 03:15 UTC).
--
-- To change retention: ALTER the default parameter value in the function, or
-- pass an explicit value in the cron job SQL.
-- To disable a specific cleanup: comment out its SELECT line in the cron job.
-- To revert: SELECT cron.unschedule('purge-log-tables-daily');

-- ─── 1. iot_sensor_readings ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_iot_sensor_readings(
  retention_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.iot_sensor_readings
    WHERE recorded_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  IF v_deleted > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, action_params, target_type, detail
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'system',
      'purge_old_iot_sensor_readings',
      'system.purge_old_iot_sensor_readings',
      jsonb_build_object('deleted', v_deleted, 'retention_days', retention_days),
      'iot_sensor_readings',
      format('Purged %s IoT sensor readings older than %s days', v_deleted, retention_days)
    );
  END IF;

  RETURN v_deleted;
END;
$$;

-- ─── 2. screen_logs ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_screen_logs(
  retention_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.screen_logs
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  IF v_deleted > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, action_params, target_type, detail
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'system',
      'purge_old_screen_logs',
      'system.purge_old_screen_logs',
      jsonb_build_object('deleted', v_deleted, 'retention_days', retention_days),
      'screen_logs',
      format('Purged %s screen logs older than %s days', v_deleted, retention_days)
    );
  END IF;

  RETURN v_deleted;
END;
$$;

-- ─── 3. playback_logs ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_playback_logs(
  retention_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.playback_logs
    WHERE played_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  IF v_deleted > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, action_params, target_type, detail
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'system',
      'purge_old_playback_logs',
      'system.purge_old_playback_logs',
      jsonb_build_object('deleted', v_deleted, 'retention_days', retention_days),
      'playback_logs',
      format('Purged %s playback log rows older than %s days', v_deleted, retention_days)
    );
  END IF;

  RETURN v_deleted;
END;
$$;

-- ─── 4. smart_trigger_logs ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.purge_old_smart_trigger_logs(
  retention_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.smart_trigger_logs
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  IF v_deleted > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, action_params, target_type, detail
    ) VALUES (
      '00000000-0000-0000-0000-000000000000'::uuid,
      'system',
      'purge_old_smart_trigger_logs',
      'system.purge_old_smart_trigger_logs',
      jsonb_build_object('deleted', v_deleted, 'retention_days', retention_days),
      'smart_trigger_logs',
      format('Purged %s smart trigger logs older than %s days', v_deleted, retention_days)
    );
  END IF;

  RETURN v_deleted;
END;
$$;

-- ─── 5. Manual run RPC (system admin only) ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.run_log_purge_now(
  iot_days   integer DEFAULT 90,
  screen_days integer DEFAULT 90,
  playback_days integer DEFAULT 90,
  trigger_days  integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_iot     integer;
  v_screen  integer;
  v_play    integer;
  v_trigger integer;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_iot     := public.purge_old_iot_sensor_readings(iot_days);
  v_screen  := public.purge_old_screen_logs(screen_days);
  v_play    := public.purge_old_playback_logs(playback_days);
  v_trigger := public.purge_old_smart_trigger_logs(trigger_days);

  RETURN jsonb_build_object(
    'success', true,
    'deleted', jsonb_build_object(
      'iot_sensor_readings', v_iot,
      'screen_logs',         v_screen,
      'playback_logs',       v_play,
      'smart_trigger_logs',  v_trigger
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_log_purge_now(integer, integer, integer, integer) TO authenticated;

-- ─── 6. Schedule daily at 03:30 UTC ─────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('purge-log-tables-daily');
EXCEPTION WHEN others THEN NULL;
END $$;

SELECT cron.schedule(
  'purge-log-tables-daily',
  '30 3 * * *',
  $cron$
    SELECT public.purge_old_iot_sensor_readings(90);
    SELECT public.purge_old_screen_logs(90);
    SELECT public.purge_old_playback_logs(90);
    SELECT public.purge_old_smart_trigger_logs(30);
  $cron$
);
