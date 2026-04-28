
-- 1. Update handle_new_user to auto-create org, team, and assign admin role for first user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _org_name text;
  _org_id uuid;
  _team_id uuid;
  _is_first boolean := false;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  );

  -- Handle organization from signup metadata
  _org_name := trim(NEW.raw_user_meta_data->>'org_name');

  IF _org_name IS NOT NULL AND _org_name != '' THEN
    -- Check if org already exists (case-insensitive)
    SELECT id INTO _org_id FROM public.organizations WHERE lower(name) = lower(_org_name) LIMIT 1;

    IF _org_id IS NULL THEN
      -- First user registering this org
      INSERT INTO public.organizations (name, created_by)
      VALUES (_org_name, NEW.id)
      RETURNING id INTO _org_id;
      _is_first := true;
    END IF;

    -- Get or create default team
    SELECT id INTO _team_id FROM public.teams WHERE org_id = _org_id LIMIT 1;
    IF _team_id IS NULL THEN
      INSERT INTO public.teams (org_id, name, description, created_by)
      VALUES (_org_id, 'Default', 'Default team', NEW.id)
      RETURNING id INTO _team_id;
    END IF;

    -- Add user to team
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_team_id, NEW.id, CASE WHEN _is_first THEN 'admin' ELSE 'member' END);

    -- If first user in org, assign admin app role
    IF _is_first THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Update handle_new_user_role to skip if a role was already assigned (by handle_new_user)
CREATE OR REPLACE FUNCTION public.handle_new_user_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  END IF;
  RETURN NEW;
END;
$$;
