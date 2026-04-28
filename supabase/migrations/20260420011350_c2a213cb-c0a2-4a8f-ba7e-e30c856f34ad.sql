-- Replace hardcoded system admin UUID (3fbb2f97-7268-4cac-a511-7cff6654a8f7) with is_system_admin() in functions and policies.

-- 1. generate_license_codes (with _plan_tier overload)
CREATE OR REPLACE FUNCTION public.generate_license_codes(_plan_name text, _extend_days integer, _assigned_org_id uuid, _count integer, _plan_tier plan_tier DEFAULT NULL::plan_tier)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_allowed_plans text[] := ARRAY[
    '三十天試用','標準季度授權','標準半年授權','標準年度授權',
    '三年授權','五年授權','永久授權'
  ];
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  v_i integer;
  v_org_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  IF _plan_name IS NULL OR NOT (_plan_name = ANY(v_allowed_plans)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_plan_name');
  END IF;
  IF _extend_days IS NULL OR _extend_days < 1 OR _extend_days > 36500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_extend_days');
  END IF;
  IF _count IS NULL OR _count < 1 OR _count > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_count');
  END IF;
  IF _assigned_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_required');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = _assigned_org_id;
  IF v_org_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_not_found');
  END IF;

  FOR v_i IN 1.._count LOOP
    v_code := upper(substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 3));
    INSERT INTO public.license_codes (code, extend_days, plan_name, plan_tier, assigned_org_id, created_by)
    VALUES (v_code, _extend_days, _plan_name, _plan_tier, _assigned_org_id, v_caller);
    v_codes := array_append(v_codes, v_code);
  END LOOP;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'generate_license_codes', 'license', 'license_codes',
    _assigned_org_id::text, v_org_name,
    format('Generated %s code(s); plan=%s; days=%s; tier=%s', _count, _plan_name, _extend_days, COALESCE(_plan_tier::text, 'none')),
    _assigned_org_id
  );

  RETURN jsonb_build_object('success', true, 'codes', v_codes);
END;
$function$;

-- 2. generate_license_codes (legacy 4-arg overload)
CREATE OR REPLACE FUNCTION public.generate_license_codes(_plan_name text, _extend_days integer, _assigned_org_id uuid, _count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_allowed_plans text[] := ARRAY[
    '三十天試用','標準季度授權','標準半年授權','標準年度授權',
    '三年授權','五年授權','永久授權'
  ];
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  v_i integer;
  v_org_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  IF _plan_name IS NULL OR NOT (_plan_name = ANY(v_allowed_plans)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_plan_name');
  END IF;
  IF _extend_days IS NULL OR _extend_days < 1 OR _extend_days > 36500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_extend_days');
  END IF;
  IF _count IS NULL OR _count < 1 OR _count > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_count');
  END IF;
  IF _assigned_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_required');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = _assigned_org_id;
  IF v_org_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_not_found');
  END IF;

  FOR v_i IN 1.._count LOOP
    v_code := upper(substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 4) || '-'
              || substr(encode(extensions.gen_random_bytes(16), 'hex'), 1, 3));
    INSERT INTO public.license_codes (code, extend_days, plan_name, assigned_org_id, created_by)
    VALUES (v_code, _extend_days, _plan_name, _assigned_org_id, v_caller);
    v_codes := array_append(v_codes, v_code);
  END LOOP;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'generate_license_codes', 'license', 'license_codes',
    _assigned_org_id::text, v_org_name,
    format('Generated %s code(s); plan=%s; days=%s', _count, _plan_name, _extend_days),
    _assigned_org_id
  );

  RETURN jsonb_build_object('success', true, 'codes', v_codes);
END;
$function$;

-- 3. delete_license_code
CREATE OR REPLACE FUNCTION public.delete_license_code(_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_code public.license_codes%ROWTYPE;
  v_org_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.is_active_cs_agent(v_caller)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT * INTO v_code FROM public.license_codes WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;
  IF v_code.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_pending');
  END IF;

  DELETE FROM public.license_codes WHERE id = _id;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_code.assigned_org_id;
  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'delete_license_code', 'license', 'license_codes',
    v_code.id::text, COALESCE(v_org_name, ''),
    format('Deleted code %s; plan=%s; days=%s', v_code.code, v_code.plan_name, v_code.extend_days),
    v_code.assigned_org_id
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

-- 4. admin_unlock_redeem_attempts
CREATE OR REPLACE FUNCTION public.admin_unlock_redeem_attempts(_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_window interval := interval '15 minutes';
  v_deleted integer;
  v_target_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT public.is_system_admin(v_caller) THEN
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

-- 5. redeem_license_code: notify ALL system admins (was: single hardcoded UUID)
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
  v_already_notified boolean;
  v_caller_name text;
  v_old_tier public.plan_tier;
  v_new_tier public.plan_tier;
  v_admin_id uuid;
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
      SELECT 1 FROM public.notifications n
      JOIN public.system_admins sa ON sa.user_id = n.user_id
      WHERE n.type = 'security_alert'
        AND n.created_by = v_caller
        AND n.created_at > now() - v_window
    ) INTO v_already_notified;

    IF NOT v_already_notified THEN
      SELECT display_name INTO v_caller_name FROM public.profiles WHERE user_id = v_caller;
      v_caller_name := COALESCE(v_caller_name, substr(v_caller::text, 1, 8));

      FOR v_admin_id IN SELECT user_id FROM public.system_admins LOOP
        INSERT INTO public.notifications (user_id, type, title, body, link, created_by)
        VALUES (
          v_admin_id,
          'security_alert',
          '可疑的授權碼暴力嘗試',
          v_caller_name || ' 已在 15 分鐘內失敗 ' || (v_recent_failures + 1) || ' 次，已被自動封鎖',
          '/cs-licenses',
          v_caller
        );
      END LOOP;

      INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
      VALUES (
        v_caller, 'license_redeem_rate_limited', 'security', 'user',
        v_caller::text, v_caller_name,
        format('User %s blocked after %s failed redeem attempts within 15 minutes; system admins notified', v_caller_name, v_recent_failures + 1),
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
  v_old_tier := v_org.plan_tier;
  v_new_tier := COALESCE(v_code.plan_tier, v_org.plan_tier);

  UPDATE public.organizations
    SET license_expires_at = v_new_expiry,
        license_plan = v_code.plan_name,
        plan_tier = v_new_tier,
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

  IF v_code.plan_tier IS NOT NULL AND v_old_tier <> v_new_tier THEN
    INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
    VALUES (
      v_caller, 'change_org_plan_tier', 'license', 'organization',
      _org_id::text, v_org.name,
      format('plan_tier: %s → %s (via license code %s)', v_old_tier, v_new_tier, v_code.code),
      _org_id
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'new_expiry', v_new_expiry,
    'plan', v_code.plan_name,
    'plan_tier', v_new_tier,
    'tier_changed', (v_code.plan_tier IS NOT NULL AND v_old_tier <> v_new_tier)
  );
END;
$function$;

-- 6. Replace legacy protect triggers (which referenced hardcoded UUID) with system_admins-aware versions
CREATE OR REPLACE FUNCTION public.protect_system_admin_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = OLD.user_id AND is_root = true) THEN
    RAISE EXCEPTION 'Cannot delete the root system administrator profile';
  END IF;
  RETURN OLD;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_system_admin_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.system_admins WHERE user_id = OLD.user_id AND is_root = true) AND OLD.role = 'admin' THEN
    RAISE EXCEPTION 'Cannot remove or modify the root system administrator role';
  END IF;
  RETURN OLD;
END;
$function$;

-- 7. Defensively rewrite any RLS policy expressions that still reference the hardcoded UUID
DO $$
DECLARE
  r record;
  new_using text;
  new_check text;
  sql text;
  uuid_pattern text := '\(?auth\.uid\(\)\s*=\s*''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?\)?';
  uuid_pattern_rev text := '\(?''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?\s*=\s*auth\.uid\(\)\)?';
  literal_pattern text := '''3fbb2f97-7268-4cac-a511-7cff6654a8f7''(::uuid)?';
BEGIN
  FOR r IN
    SELECT n.nspname AS schema_name,
           c.relname AS table_name,
           p.polname,
           p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) AS using_expr,
           pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE COALESCE(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%'
       OR COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%'
  LOOP
    new_using := r.using_expr;
    new_check := r.check_expr;

    IF new_using IS NOT NULL THEN
      new_using := regexp_replace(new_using, uuid_pattern, 'public.is_system_admin(auth.uid())', 'g');
      new_using := regexp_replace(new_using, uuid_pattern_rev, 'public.is_system_admin(auth.uid())', 'g');
      -- Fallback: any remaining literal occurrences (e.g. inside a list) — leave as a comment-safe replacement using IN
      IF new_using LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%' THEN
        new_using := regexp_replace(new_using, literal_pattern, '(SELECT user_id FROM public.system_admins WHERE is_root = true LIMIT 1)', 'g');
      END IF;
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := regexp_replace(new_check, uuid_pattern, 'public.is_system_admin(auth.uid())', 'g');
      new_check := regexp_replace(new_check, uuid_pattern_rev, 'public.is_system_admin(auth.uid())', 'g');
      IF new_check LIKE '%3fbb2f97-7268-4cac-a511-7cff6654a8f7%' THEN
        new_check := regexp_replace(new_check, literal_pattern, '(SELECT user_id FROM public.system_admins WHERE is_root = true LIMIT 1)', 'g');
      END IF;
    END IF;

    sql := format('ALTER POLICY %I ON %I.%I', r.polname, r.schema_name, r.table_name);
    IF new_using IS NOT NULL THEN
      sql := sql || format(' USING (%s)', new_using);
    END IF;
    IF new_check IS NOT NULL THEN
      sql := sql || format(' WITH CHECK (%s)', new_check);
    END IF;

    RAISE NOTICE 'Rewriting policy: %', sql;
    EXECUTE sql;
  END LOOP;
END
$$;