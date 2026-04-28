
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_name text;
  _org_id uuid;
  _team_id uuid;
  _is_first boolean := false;
  _invite_token text;
  _invite_org_id uuid;
  _cs_agent_id uuid;
BEGIN
  -- Create profile
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  );

  -- Check for CS agent signup
  _cs_agent_id := (NEW.raw_user_meta_data->>'cs_agent')::uuid;
  IF _cs_agent_id IS NOT NULL THEN
    UPDATE public.cs_agents
    SET user_id = NEW.id, status = 'active', updated_at = now()
    WHERE id = _cs_agent_id
      AND lower(email) = lower(NEW.email)
      AND status = 'invited';
    -- CS agents don't need org assignment via this flow
    RETURN NEW;
  END IF;

  -- Check for invitation token first
  _invite_token := trim(NEW.raw_user_meta_data->>'invite_token');

  IF _invite_token IS NOT NULL AND _invite_token != '' THEN
    SELECT i.org_id INTO _invite_org_id
    FROM public.invitations i
    WHERE i.token = _invite_token
      AND i.status = 'pending'
      AND i.expires_at > now()
      AND lower(i.email) = lower(NEW.email)
    LIMIT 1;

    IF _invite_org_id IS NOT NULL THEN
      UPDATE public.invitations SET status = 'accepted' WHERE token = _invite_token;

      SELECT id INTO _team_id FROM public.teams WHERE org_id = _invite_org_id LIMIT 1;
      IF _team_id IS NULL THEN
        INSERT INTO public.teams (org_id, name, description, created_by)
        VALUES (_invite_org_id, 'Default', 'Default team', NEW.id)
        RETURNING id INTO _team_id;
      END IF;

      INSERT INTO public.team_members (team_id, user_id, role)
      VALUES (_team_id, NEW.id, 'member');

      RETURN NEW;
    END IF;
  END IF;

  -- Handle organization from signup metadata
  _org_name := trim(NEW.raw_user_meta_data->>'org_name');

  IF _org_name IS NOT NULL AND _org_name != '' THEN
    SELECT id INTO _org_id FROM public.organizations WHERE lower(name) = lower(_org_name) LIMIT 1;

    IF _org_id IS NULL THEN
      INSERT INTO public.organizations (name, created_by)
      VALUES (_org_name, NEW.id)
      RETURNING id INTO _org_id;
      _is_first := true;
    END IF;

    SELECT id INTO _team_id FROM public.teams WHERE org_id = _org_id LIMIT 1;
    IF _team_id IS NULL THEN
      INSERT INTO public.teams (org_id, name, description, created_by)
      VALUES (_org_id, 'Default', 'Default team', NEW.id)
      RETURNING id INTO _team_id;
    END IF;

    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_team_id, NEW.id, CASE WHEN _is_first THEN 'admin' ELSE 'member' END);

    IF _is_first THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
