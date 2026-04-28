-- Helper guard: reject anonymous + non-admin callers
CREATE OR REPLACE FUNCTION public.update_schedule_cleanup_settings(
  _retention_days integer,
  _enabled boolean,
  _media_retention_days integer DEFAULT NULL,
  _media_enabled boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF NOT (public.is_system_admin(v_uid) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF _retention_days < 1 OR _retention_days > 3650 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_retention_days');
  END IF;

  IF _media_retention_days IS NOT NULL AND (_media_retention_days < 1 OR _media_retention_days > 3650) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_media_retention_days');
  END IF;

  UPDATE public.schedule_cleanup_settings
     SET retention_days = _retention_days,
         enabled = _enabled,
         media_retention_days = COALESCE(_media_retention_days, media_retention_days),
         media_enabled = COALESCE(_media_enabled, media_enabled),
         updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.run_schedule_cleanup_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
  v_err text;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF NOT (public.is_system_admin(v_uid) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  BEGIN
    SELECT public.auto_delete_old_expired_channel_blocks() INTO v_deleted;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.schedule_cleanup_settings
       SET last_run_at = now(),
           last_run_by = v_uid,
           last_run_status = 'failed',
           last_run_error = v_err,
           last_deleted_count = 0,
           updated_at = now()
     WHERE id = 1;
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END;

  UPDATE public.schedule_cleanup_settings
     SET last_run_at = now(),
         last_run_by = v_uid,
         last_run_status = 'success',
         last_run_error = NULL,
         last_deleted_count = COALESCE(v_deleted, 0),
         updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'deleted', COALESCE(v_deleted, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.run_media_cleanup_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_deleted integer;
  v_err text;
BEGIN
  IF v_uid IS NULL OR auth.role() <> 'authenticated' THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  IF NOT (public.is_system_admin(v_uid) OR public.has_role(v_uid, 'admin'::public.app_role)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  BEGIN
    SELECT public.auto_delete_unused_media() INTO v_deleted;
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    UPDATE public.schedule_cleanup_settings
       SET media_last_run_at = now(),
           media_last_run_by = v_uid,
           media_last_run_status = 'failed',
           media_last_run_error = v_err,
           media_last_deleted_count = 0,
           updated_at = now()
     WHERE id = 1;
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END;

  UPDATE public.schedule_cleanup_settings
     SET media_last_run_at = now(),
         media_last_run_by = v_uid,
         media_last_run_status = 'success',
         media_last_run_error = NULL,
         media_last_deleted_count = COALESCE(v_deleted, 0),
         updated_at = now()
   WHERE id = 1;

  RETURN jsonb_build_object('success', true, 'deleted', COALESCE(v_deleted, 0));
END;
$$;

-- Lock down execute privileges: deny public/anon, allow only authenticated users.
REVOKE ALL ON FUNCTION public.update_schedule_cleanup_settings(integer, boolean, integer, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.run_schedule_cleanup_now() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.run_media_cleanup_now() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.update_schedule_cleanup_settings(integer, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_schedule_cleanup_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.run_media_cleanup_now() TO authenticated;