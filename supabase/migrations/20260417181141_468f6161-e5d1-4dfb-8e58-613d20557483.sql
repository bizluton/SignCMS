-- Allow an authenticated user without any org to bootstrap a brand-new organization
-- and become its org_admin. Mirrors the org_name path in handle_new_user(),
-- but works post-signup (e.g. after Google OAuth where org_name was not collected).
CREATE OR REPLACE FUNCTION public.bootstrap_user_organization(_org_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_name text := trim(_org_name);
  v_org_id uuid;
  v_team_id uuid;
  v_default_perms jsonb := '["screens","media","schedules","publish","studio"]'::jsonb;
  v_already_in_org boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'unauthenticated');
  END IF;
  IF v_name IS NULL OR length(v_name) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_name');
  END IF;
  IF length(v_name) > 100 THEN
    RETURN jsonb_build_object('success', false, 'error', 'name_too_long');
  END IF;

  -- Block if caller is already a member of any organization
  SELECT EXISTS (
    SELECT 1 FROM public.team_members tm WHERE tm.user_id = v_caller
  ) INTO v_already_in_org;
  IF v_already_in_org THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_in_org');
  END IF;

  -- Reuse existing org if name matches (case-insensitive); otherwise create
  SELECT id INTO v_org_id FROM public.organizations WHERE lower(name) = lower(v_name) LIMIT 1;
  IF v_org_id IS NULL THEN
    INSERT INTO public.organizations (name, created_by) VALUES (v_name, v_caller) RETURNING id INTO v_org_id;
  END IF;

  -- Ensure default team exists
  SELECT id INTO v_team_id FROM public.teams WHERE org_id = v_org_id LIMIT 1;
  IF v_team_id IS NULL THEN
    INSERT INTO public.teams (org_id, name, description, created_by, permissions)
    VALUES (v_org_id, 'Default', 'Default team', v_caller, v_default_perms)
    RETURNING id INTO v_team_id;
  END IF;

  -- Add caller to the team as admin (since they bootstrap the org)
  INSERT INTO public.team_members (team_id, user_id, role) VALUES (v_team_id, v_caller, 'admin');

  -- Promote caller to org_admin (idempotent)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_caller, 'org_admin')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.activity_logs (user_id, action, category, target_type, target_id, target_name, detail, org_id)
  VALUES (
    v_caller, 'bootstrap_organization', 'org', 'organization',
    v_org_id::text, v_name,
    format('User bootstrapped organization %s after social login', v_name),
    v_org_id
  );

  RETURN jsonb_build_object('success', true, 'org_id', v_org_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.bootstrap_user_organization(text) TO authenticated;