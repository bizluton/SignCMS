-- 1. Attempts log table
CREATE TABLE public.license_redeem_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid,
  code_attempted text NOT NULL,
  success boolean NOT NULL DEFAULT false,
  error_code text,
  attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_lra_user_time ON public.license_redeem_attempts (user_id, attempt_at DESC);

ALTER TABLE public.license_redeem_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System admin can view redeem attempts"
  ON public.license_redeem_attempts FOR SELECT TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

CREATE POLICY "CS agents can view redeem attempts"
  ON public.license_redeem_attempts FOR SELECT TO authenticated
  USING (public.is_active_cs_agent(auth.uid()));

CREATE POLICY "Users can view own redeem attempts"
  ON public.license_redeem_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 2. Updated redeem RPC with rate limiting
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
  v_recent_failures integer;
  v_window interval := interval '15 minutes';
  v_max_failures integer := 5;
  v_err text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;

  -- Rate limit BEFORE permission check so attacker probing also gets locked
  SELECT count(*) INTO v_recent_failures
    FROM public.license_redeem_attempts
    WHERE user_id = v_caller
      AND success = false
      AND attempt_at > now() - v_window;

  IF v_recent_failures >= v_max_failures THEN
    INSERT INTO public.license_redeem_attempts (user_id, org_id, code_attempted, success, error_code)
    VALUES (v_caller, _org_id, COALESCE(_code, ''), false, 'rate_limited');
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

  -- Success: log + clear past failures for this user
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
$$;