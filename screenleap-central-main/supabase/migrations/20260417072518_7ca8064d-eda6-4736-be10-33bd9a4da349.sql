CREATE OR REPLACE FUNCTION public.redeem_license_code(_code text, _org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_code public.license_codes%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_new_expiry timestamptz;
  v_recent_failures integer;
  v_window interval := interval '15 minutes';
  v_max_failures integer := 5;
  v_err text;
  v_sys_admin uuid := '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid;
  v_already_notified boolean;
  v_caller_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  SELECT count(*) INTO v_recent_failures
    FROM public.license_redeem_attempts
    WHERE user_id = v_caller
      AND success = false
      AND attempt_at > now() - v_window;

  IF v_recent_failures >= v_max_failures THEN
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, COALESCE(_code, ''), false, 'rate_limited');

    SELECT EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = v_sys_admin
        AND type = 'security_alert'
        AND created_by = v_caller
        AND created_at > now() - v_window
    ) INTO v_already_notified;

    IF NOT v_already_notified THEN
      SELECT display_name INTO v_caller_name FROM public.profiles WHERE user_id = v_caller;
      v_caller_name := COALESCE(v_caller_name, substr(v_caller::text, 1, 8));

      INSERT INTO public.notifications (user_id, type, title, body, link, created_by)
      VALUES (
        v_sys_admin,
        'security_alert',
        '可疑的授權碼暴力嘗試',
        v_caller_name || ' 已在 15 分鐘內失敗 ' || (v_recent_failures + 1) || ' 次，已被自動封鎖',
        '/cs-licenses',
        v_caller
      );

      -- Audit log for the security alert
      INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
      VALUES (
        v_caller, 'license_redeem_rate_limited', 'security', 'user',
        v_caller::text, v_caller_name,
        format('User %s blocked after %s failed redeem attempts within 15 minutes; system admin notified', v_caller_name, v_recent_failures + 1),
        _org_id
      );
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'rate_limited');
  END IF;

  IF NOT (public.is_org_admin(v_caller) AND public.user_in_org(v_caller, _org_id)) THEN
    v_err := 'permission_denied';
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, COALESCE(_code, ''), false, v_err);
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  SELECT * INTO v_code FROM public.license_codes WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN
    v_err := 'code_not_found';
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, COALESCE(_code, ''), false, v_err);
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  IF v_code.status <> 'pending' THEN
    v_err := 'code_already_redeemed';
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, _code, false, v_err);
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  IF v_code.assigned_org_id <> _org_id THEN
    v_err := 'code_not_for_this_org';
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, _code, false, v_err);
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    v_err := 'org_not_found';
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, _code, false, v_err);
    RETURN jsonb_build_object('success', false, 'error', v_err);
  END IF;

  v_new_expiry := GREATEST(v_org.license_expires_at, now()) + (v_code.extend_days || ' days')::interval;

  UPDATE public.organizations
    SET license_expires_at = v_new_expiry,
        license_plan = v_code.plan_name,
        license_reminder_sent = '[]'::jsonb,
        updated_at = now()
    WHERE id = _org_id;

  UPDATE public.license_codes
    SET status = 'redeemed',
        redeemed_by_org = _org_id,
        redeemed_at = now()
    WHERE id = v_code.id;

  INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
  VALUES (v_caller, _org_id, _code, true, NULL);

  DELETE FROM public.license_redeem_attempts
    WHERE user_id = v_caller AND success = false AND attempt_at > now() - v_window;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'redeem_license_code', 'license', 'license_codes',
    v_code.id::text, v_org.name,
    format('Redeemed code %s; plan=%s; days=%s; new_expiry=%s', v_code.code, v_code.plan_name, v_code.extend_days, v_new_expiry::text),
    _org_id
  );

  RETURN jsonb_build_object('success', true, 'new_expiry', v_new_expiry, 'plan', v_code.plan_name);
END;
$function$;