CREATE OR REPLACE FUNCTION public.admin_unlock_redeem_attempts(_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_sys_admin uuid := '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid;
  v_window interval := interval '15 minutes';
  v_deleted integer;
  v_target_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF v_caller <> v_sys_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_user');
  END IF;

  SELECT display_name INTO v_target_name FROM public.profiles WHERE user_id = _user_id;
  v_target_name := COALESCE(v_target_name, substr(_user_id::text, 1, 8));

  WITH del AS (
    DELETE FROM public.license_redeem_attempts
    WHERE user_id = _user_id
      AND success = false
      AND attempt_at > now() - v_window
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail)
  VALUES (
    v_caller, 'admin_unlock_redeem_attempts', 'security', 'user',
    _user_id::text, v_target_name,
    format('System admin manually unlocked %s; cleared %s recent failed attempts', v_target_name, v_deleted)
  );

  RETURN jsonb_build_object('success', true, 'cleared', v_deleted);
END;
$function$;