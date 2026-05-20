-- Additional TTL retention for tables that currently grow unbounded.
--
-- 20260429000002_log_table_ttl_cleanup.sql covers:
--   iot_sensor_readings / screen_logs / playback_logs / smart_trigger_logs
--
-- 20260520000003_device_activation_security.sql covers:
--   device_activation_attempts (24h)
--
-- This migration adds retention for the remaining high-growth tables that
-- could become problematic at the 100 org / 10k device scale:
--
--   activity_logs          — every UI mutation; can hit 100k–1M rows/day
--   email_send_log         — per send + retry; 50k+ rows/month
--   mcp_audit_log          — per MCP tool call
--   license_redeem_attempts — failed attempts during attacks
--   publish_records        — keep longer; only purge very old
--   store_app_webhook_logs — per webhook delivery
--   screen_alerts          — DELETE resolved alerts older than threshold
--
-- All cleanup functions follow the same pattern as the original migration:
-- SECURITY DEFINER, bounded by retention_days argument, idempotent.

-- ─── activity_logs (90 days) ────────────────────────────────────────────────
-- Keep security-related logs longer for audit purposes (180 days).
CREATE OR REPLACE FUNCTION public.purge_old_activity_logs(
  retention_days          integer DEFAULT 90,
  security_retention_days integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;
  IF security_retention_days < retention_days THEN
    security_retention_days := retention_days;
  END IF;

  WITH del AS (
    DELETE FROM public.activity_logs
    WHERE (
      (category = 'security' AND created_at < now() - make_interval(days => security_retention_days))
      OR
      (category <> 'security' AND created_at < now() - make_interval(days => retention_days))
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── email_send_log (180 days, for compliance) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_email_send_log(
  retention_days integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.email_send_log
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── mcp_audit_log (90 days) ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_mcp_audit_log(
  retention_days integer DEFAULT 90
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.mcp_audit_log
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── license_redeem_attempts (30 days; mostly failed brute-force) ──────────
CREATE OR REPLACE FUNCTION public.purge_old_license_redeem_attempts(
  retention_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.license_redeem_attempts
    WHERE attempt_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── publish_records (365 days; keep longer for audit) ─────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_publish_records(
  retention_days integer DEFAULT 365
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.publish_records
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── store_app_webhook_logs (30 days) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purge_old_store_app_webhook_logs(
  retention_days integer DEFAULT 30
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.store_app_webhook_logs
    WHERE created_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── screen_alerts (DELETE resolved older than 180 days) ───────────────────
-- Active alerts (resolved_at IS NULL) are kept forever — they are the
-- current alarm state.
CREATE OR REPLACE FUNCTION public.purge_old_resolved_screen_alerts(
  retention_days integer DEFAULT 180
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF retention_days < 1 THEN retention_days := 1; END IF;

  WITH del AS (
    DELETE FROM public.screen_alerts
    WHERE resolved_at IS NOT NULL
      AND resolved_at < now() - make_interval(days => retention_days)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

-- ─── Schedule daily at 04:00 UTC (after the existing 03:30 UTC purge) ──────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('purge-additional-tables-daily');
    EXCEPTION WHEN others THEN NULL;
    END;

    PERFORM cron.schedule(
      'purge-additional-tables-daily',
      '0 4 * * *',
      $cron$
        SELECT public.purge_old_activity_logs();
        SELECT public.purge_old_email_send_log();
        SELECT public.purge_old_mcp_audit_log();
        SELECT public.purge_old_license_redeem_attempts();
        SELECT public.purge_old_publish_records();
        SELECT public.purge_old_store_app_webhook_logs();
        SELECT public.purge_old_resolved_screen_alerts();
      $cron$
    );
    RAISE NOTICE 'purge-additional-tables-daily cron scheduled (04:00 UTC).';
  ELSE
    RAISE NOTICE 'pg_cron not available — schedule retention externally.';
  END IF;
END
$$;

-- ─── Manual run RPC (system admin only) ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.run_additional_log_purge_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_activity int;
  v_email    int;
  v_mcp      int;
  v_license  int;
  v_publish  int;
  v_webhook  int;
  v_alerts   int;
BEGIN
  IF NOT public.is_system_admin(auth.uid()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  v_activity := public.purge_old_activity_logs();
  v_email    := public.purge_old_email_send_log();
  v_mcp      := public.purge_old_mcp_audit_log();
  v_license  := public.purge_old_license_redeem_attempts();
  v_publish  := public.purge_old_publish_records();
  v_webhook  := public.purge_old_store_app_webhook_logs();
  v_alerts   := public.purge_old_resolved_screen_alerts();

  RETURN jsonb_build_object(
    'success', true,
    'deleted', jsonb_build_object(
      'activity_logs',          v_activity,
      'email_send_log',         v_email,
      'mcp_audit_log',          v_mcp,
      'license_redeem_attempts', v_license,
      'publish_records',        v_publish,
      'store_app_webhook_logs', v_webhook,
      'resolved_screen_alerts', v_alerts
    )
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.run_additional_log_purge_now() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.run_additional_log_purge_now() TO authenticated;
