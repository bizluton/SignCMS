-- Fix: use extensions.gen_random_bytes so pgcrypto is found regardless of search_path
CREATE OR REPLACE FUNCTION public.issue_screen_device_token(_screen_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_screen RECORD;
  v_token  text;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT id, org_id, name INTO v_screen FROM public.screens WHERE id = _screen_id;
  IF v_screen.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'screen_not_found');
  END IF;

  -- Only system admin or org admin/admin role may issue tokens
  IF NOT (
    v_caller = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid
    OR EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = v_caller AND org_id = v_screen.org_id AND role IN ('org_admin','admin')
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'permission_denied');
  END IF;

  -- extensions schema ensures pgcrypto is resolved correctly in Supabase
  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.screens
  SET device_token           = v_token,
      device_token_issued_at = now(),
      device_token_issued_by = v_caller,
      updated_at             = now()
  WHERE id = _screen_id;

  RETURN jsonb_build_object('ok', true, 'screen_id', _screen_id, 'token', v_token, 'issued_at', now());
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_screen_device_token(uuid) TO authenticated;
