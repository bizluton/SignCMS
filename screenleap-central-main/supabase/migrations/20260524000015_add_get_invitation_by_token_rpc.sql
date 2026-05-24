-- Anon-callable RPC to resolve an invitation by its token. Used by the
-- signup page to prefill and lock the Email field per SIGNCMS組織權限規則
-- step 2: "註冊頁面之 EMAIL 欄位直接帶入使用者之 EMAIL，EMAIL 不可更改也不需再次做驗證"
--
-- Returns only the minimal safe fields (email + org name + org_id) needed
-- by the signup form. Does NOT expose other invitation fields, invited_by,
-- short_code, or any other unrelated invitations.

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv RECORD;
  v_org_name text;
BEGIN
  IF p_token IS NULL OR length(p_token) < 20 THEN
    RETURN jsonb_build_object('valid', false, 'error', 'invalid_token');
  END IF;

  SELECT id, email, org_id, expires_at, status
    INTO v_inv
    FROM public.invitations
   WHERE token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'error', 'not_found');
  END IF;
  IF v_inv.status = 'accepted' THEN
    RETURN jsonb_build_object('valid', false, 'error', 'already_accepted');
  END IF;
  IF v_inv.expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'error', 'expired');
  END IF;

  SELECT name INTO v_org_name FROM public.organizations WHERE id = v_inv.org_id;

  RETURN jsonb_build_object(
    'valid', true,
    'email', v_inv.email,
    'org_id', v_inv.org_id,
    'org_name', coalesce(v_org_name, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
