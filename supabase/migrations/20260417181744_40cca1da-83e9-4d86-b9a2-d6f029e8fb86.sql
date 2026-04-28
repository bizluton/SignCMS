-- RPC: redeem an invitation token for an already-authenticated user that has no org yet.
CREATE OR REPLACE FUNCTION public.redeem_invitation_token(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _email text;
  _token text := trim(_token);
  _inv record;
  _team_id uuid;
  _default_perms jsonb := '["screens","media","schedules","publish","studio"]'::jsonb;
BEGIN
  IF _caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF _token IS NULL OR _token = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;

  -- Already in an org? Don't double-join via this flow.
  IF EXISTS (SELECT 1 FROM public.team_members WHERE user_id = _caller LIMIT 1) THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_in_org');
  END IF;

  SELECT email INTO _email FROM auth.users WHERE id = _caller;

  SELECT i.id, i.org_id, i.email, i.status, i.expires_at
    INTO _inv
  FROM public.invitations i
  WHERE i.token = _token
  LIMIT 1;

  IF _inv.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_token');
  END IF;
  IF _inv.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_used');
  END IF;
  IF _inv.expires_at <= now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'token_expired');
  END IF;
  IF lower(_inv.email) <> lower(_email) THEN
    RETURN jsonb_build_object('success', false, 'error', 'email_mismatch');
  END IF;

  SELECT id INTO _team_id FROM public.teams WHERE org_id = _inv.org_id LIMIT 1;
  IF _team_id IS NULL THEN
    INSERT INTO public.teams (org_id, name, description, created_by, permissions)
    VALUES (_inv.org_id, 'Default', 'Default team', _caller, _default_perms)
    RETURNING id INTO _team_id;
  END IF;

  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (_team_id, _caller, 'member')
  ON CONFLICT DO NOTHING;

  UPDATE public.invitations SET status = 'accepted' WHERE id = _inv.id;

  RETURN jsonb_build_object('success', true, 'org_id', _inv.org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_invitation_token(text) TO authenticated;