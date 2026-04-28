-- 0. Backfill assigned_org_id for legacy redeemed rows
UPDATE public.license_codes
  SET assigned_org_id = redeemed_by_org
  WHERE assigned_org_id IS NULL AND redeemed_by_org IS NOT NULL;

-- 1. Delete pending codes that have no org binding (true wildcards)
DELETE FROM public.license_codes
  WHERE assigned_org_id IS NULL AND status = 'pending';

-- Sanity: any still-NULL? (shouldn't be)
DELETE FROM public.license_codes WHERE assigned_org_id IS NULL;

-- 2. Enforce assigned_org_id NOT NULL
ALTER TABLE public.license_codes
  ALTER COLUMN assigned_org_id SET NOT NULL;

-- 3. Drop client INSERT/UPDATE/DELETE policies — only SECURITY DEFINER RPCs may write
DROP POLICY IF EXISTS "CS agents can insert license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can update license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "CS agents can delete license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "System admin can manage license_codes" ON public.license_codes;
DROP POLICY IF EXISTS "Org admins can redeem pending codes" ON public.license_codes;

CREATE POLICY "System admin can view license_codes"
  ON public.license_codes FOR SELECT TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

-- 4. Generate codes via SECURITY DEFINER RPC
CREATE OR REPLACE FUNCTION public.generate_license_codes(
  _plan_name text,
  _extend_days integer,
  _assigned_org_id uuid,
  _count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF NOT (v_caller = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid OR public.is_active_cs_agent(v_caller)) THEN
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
$$;

REVOKE ALL ON FUNCTION public.generate_license_codes(text, integer, uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.generate_license_codes(text, integer, uuid, integer) TO authenticated;

-- 5. Delete pending license code via RPC
CREATE OR REPLACE FUNCTION public.delete_license_code(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_code public.license_codes%ROWTYPE;
  v_org_name text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (v_caller = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid OR public.is_active_cs_agent(v_caller)) THEN
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
$$;

REVOKE ALL ON FUNCTION public.delete_license_code(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.delete_license_code(uuid) TO authenticated;

-- 6. Audit log inside redeem
CREATE OR REPLACE FUNCTION public.redeem_license_code(_code text, _org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_code public.license_codes%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_new_expiry timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF NOT (public.is_org_admin(v_caller) AND public.user_in_org(v_caller, _org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT * INTO v_code FROM public.license_codes WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_not_found');
  END IF;
  IF v_code.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_already_redeemed');
  END IF;
  IF v_code.assigned_org_id <> _org_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_not_for_this_org');
  END IF;

  SELECT * INTO v_org FROM public.organizations WHERE id = _org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'org_not_found');
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

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'redeem_license_code', 'license', 'license_codes',
    v_code.id::text, v_org.name,
    format('Redeemed code %s; plan=%s; days=%s; new_expiry=%s', v_code.code, v_code.plan_name, v_code.extend_days, v_new_expiry::text),
    _org_id
  );

  RETURN jsonb_build_object('success', true, 'new_expiry', v_new_expiry, 'plan', v_code.plan_name);
END;
$$;