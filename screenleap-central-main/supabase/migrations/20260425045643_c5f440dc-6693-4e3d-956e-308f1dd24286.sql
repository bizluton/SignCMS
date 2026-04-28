-- Lookup a device license by its 6-digit code.
-- Returns device info ONLY when the caller is a member of the license's org
-- (or is a system admin / active CS agent). Otherwise returns not_authorized
-- to avoid leaking device info via brute-forcing 6-digit codes.
CREATE OR REPLACE FUNCTION public.lookup_device_license_by_code(_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_row public.device_licenses%ROWTYPE;
  v_org_name text;
  v_authorized boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'error', 'unauthenticated');
  END IF;
  IF _code IS NULL OR _code !~ '^[0-9]{6}$' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_code_format');
  END IF;

  SELECT * INTO v_row FROM public.device_licenses WHERE code = _code LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'not_found');
  END IF;

  -- Authorization: caller must belong to the license's org, OR be sys admin / CS
  v_authorized := public.is_system_admin(v_caller)
               OR public.is_active_cs_agent(v_caller)
               OR public.user_in_org(v_caller, v_row.org_id);

  IF NOT v_authorized THEN
    -- Same shape as not_found to avoid info leak
    RETURN jsonb_build_object('valid', false, 'error', 'not_authorized');
  END IF;

  IF v_row.status <> 'active' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'revoked',
      'status', v_row.status,
      'org_id', v_row.org_id);
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_row.org_id;

  RETURN jsonb_build_object(
    'valid', true,
    'org_id', v_row.org_id,
    'org_name', v_org_name,
    'device_model', v_row.device_model,
    'device_serial', v_row.device_serial,
    'status', v_row.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_device_license_by_code(text) TO authenticated;