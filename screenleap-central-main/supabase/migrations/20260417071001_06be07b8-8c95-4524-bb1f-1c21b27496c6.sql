-- Add assigned_org_id to license_codes (the org allowed to redeem)
ALTER TABLE public.license_codes
  ADD COLUMN IF NOT EXISTS assigned_org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Backfill existing pending codes with redeemed_by_org if any (none expected); leave NULL allowed for legacy rows
-- Update redeem RPC to enforce assigned_org_id matches the redeeming org
CREATE OR REPLACE FUNCTION public.redeem_license_code(_code text, _org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code public.license_codes%ROWTYPE;
  v_org public.organizations%ROWTYPE;
  v_new_expiry timestamptz;
BEGIN
  -- Caller must be org admin of the target org
  IF NOT (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), _org_id)) THEN
    RETURN jsonb_build_object('success', false, 'error', 'permission_denied');
  END IF;

  SELECT * INTO v_code FROM public.license_codes WHERE code = _code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_not_found');
  END IF;
  IF v_code.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'code_already_redeemed');
  END IF;
  IF v_code.assigned_org_id IS NOT NULL AND v_code.assigned_org_id <> _org_id THEN
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

  RETURN jsonb_build_object('success', true, 'new_expiry', v_new_expiry, 'plan', v_code.plan_name);
END;
$$;