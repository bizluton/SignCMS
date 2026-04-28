-- 1) Settings table (single row, id=1)
CREATE TABLE IF NOT EXISTS public.schedule_cleanup_settings (
  id smallint PRIMARY KEY DEFAULT 1,
  retention_days integer NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_deleted_count integer NOT NULL DEFAULT 0,
  last_run_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_cleanup_settings_singleton CHECK (id = 1),
  CONSTRAINT schedule_cleanup_settings_retention_range CHECK (retention_days BETWEEN 1 AND 3650)
);

INSERT INTO public.schedule_cleanup_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.schedule_cleanup_settings ENABLE ROW LEVEL SECURITY;

-- Read: system admins or any org admin
CREATE POLICY "Admins can view schedule cleanup settings"
ON public.schedule_cleanup_settings
FOR SELECT
TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.is_org_admin(auth.uid())
);

-- Update: system admins only
CREATE POLICY "System admins can update schedule cleanup settings"
ON public.schedule_cleanup_settings
FOR UPDATE
TO authenticated
USING (public.is_system_admin(auth.uid()))
WITH CHECK (public.is_system_admin(auth.uid()));

-- 2) Update the auto-delete function to read settings and record results
CREATE OR REPLACE FUNCTION public.auto_delete_old_expired_channel_blocks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_settings public.schedule_cleanup_settings%ROWTYPE;
  v_retention integer;
  v_enabled boolean;
  affected integer := 0;
BEGIN
  SELECT * INTO v_settings FROM public.schedule_cleanup_settings WHERE id = 1;
  v_retention := COALESCE(v_settings.retention_days, 30);
  v_enabled := COALESCE(v_settings.enabled, true);

  IF NOT v_enabled THEN
    RETURN 0;
  END IF;

  WITH del AS (
    DELETE FROM public.channel_blocks
    WHERE
      (block_type = 'calendar'
        AND end_at IS NOT NULL
        AND end_at < now() - make_interval(days => v_retention))
      OR
      (block_type = 'weekly'
        AND effective_to IS NOT NULL
        AND effective_to < ((now() AT TIME ZONE 'UTC')::date - v_retention))
    RETURNING 1
  )
  SELECT count(*) INTO affected FROM del;

  UPDATE public.schedule_cleanup_settings
     SET last_run_at = now(),
         last_deleted_count = affected,
         last_run_by = auth.uid(),
         updated_at = now()
   WHERE id = 1;

  IF affected > 0 THEN
    INSERT INTO public.activity_logs (
      user_id, action, action_code, category, target_type, target_name, detail, action_params
    ) VALUES (
      COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid),
      'auto_delete_old_expired_channel_blocks',
      'SCHEDULE_AUTO_DELETED',
      'schedule',
      'channel_blocks',
      format('retention_%sd', v_retention),
      format('Auto-deleted %s expired schedule block(s) older than %s days', affected, v_retention),
      jsonb_build_object('deleted', affected, 'retention_days', v_retention)
    );
  END IF;

  RETURN affected;
END;
$$;

-- 3) RPC to update settings (system admin only)
CREATE OR REPLACE FUNCTION public.update_schedule_cleanup_settings(
  _retention_days integer,
  _enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT public.is_system_admin(v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF _retention_days IS NULL OR _retention_days < 1 OR _retention_days > 3650 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_retention_days');
  END IF;

  UPDATE public.schedule_cleanup_settings
     SET retention_days = _retention_days,
         enabled = COALESCE(_enabled, true),
         updated_at = now()
   WHERE id = 1;

  INSERT INTO public.activity_logs (
    user_id, action, action_code, category, target_type, target_name, detail, action_params
  ) VALUES (
    v_caller,
    'update_schedule_cleanup_settings',
    'SCHEDULE_CLEANUP_SETTINGS_UPDATED',
    'schedule',
    'schedule_cleanup_settings',
    'settings',
    format('Updated schedule cleanup: retention=%s days, enabled=%s', _retention_days, _enabled),
    jsonb_build_object('retention_days', _retention_days, 'enabled', _enabled)
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4) RPC to manually trigger cleanup (system admin only)
CREATE OR REPLACE FUNCTION public.run_schedule_cleanup_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_caller IS NULL OR NOT public.is_system_admin(v_caller) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  v_count := public.auto_delete_old_expired_channel_blocks();
  RETURN jsonb_build_object('success', true, 'deleted', v_count);
END;
$$;