CREATE OR REPLACE FUNCTION public.update_schedule_cleanup_settings(
  _retention_days integer,
  _enabled boolean,
  _media_retention_days integer DEFAULT NULL::integer,
  _media_enabled boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_old_media_retention integer;
  v_old_retention integer;
  v_old_enabled boolean;
  v_old_media_enabled boolean;
  v_actor_name text;
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

  SELECT retention_days, enabled, media_retention_days, media_enabled
    INTO v_old_retention, v_old_enabled, v_old_media_retention, v_old_media_enabled
    FROM public.schedule_cleanup_settings
   WHERE id = 1;

  UPDATE public.schedule_cleanup_settings
     SET retention_days = _retention_days,
         enabled = _enabled,
         media_retention_days = COALESCE(_media_retention_days, media_retention_days),
         media_enabled = COALESCE(_media_enabled, media_enabled),
         updated_at = now()
   WHERE id = 1;

  -- Audit: log media retention changes specifically so admins can trace
  -- who changed the trash restore window and when.
  IF _media_retention_days IS NOT NULL AND _media_retention_days IS DISTINCT FROM v_old_media_retention THEN
    SELECT display_name INTO v_actor_name FROM public.profiles WHERE user_id = v_uid;
    v_actor_name := COALESCE(v_actor_name, substr(v_uid::text, 1, 8));

    INSERT INTO public.activity_logs (
      user_id, category, action, action_code, action_params,
      target_type, target_name, detail
    )
    VALUES (
      v_uid, 'system', 'update_media_retention_days', 'system.media_retention_days_changed',
      jsonb_build_object(
        'old_value', v_old_media_retention,
        'new_value', _media_retention_days,
        'changed_by', v_uid,
        'changed_by_name', v_actor_name,
        'changed_at', now()
      ),
      'schedule_cleanup_settings', 'media_retention_days',
      format('%s changed trash retention from %s to %s day(s)',
        v_actor_name,
        COALESCE(v_old_media_retention::text, 'null'),
        _media_retention_days::text)
    );
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$function$;