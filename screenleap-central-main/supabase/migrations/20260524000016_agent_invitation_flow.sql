-- Agent invitation flow per SIGNCMS組織權限規則: "代理商由系統管理員邀請".
--
-- Reuses the existing invitations table + handle_new_user trigger by adding
-- two columns:
--
--   invite_type     'member' (default, joins one org's team) | 'agent'
--   agent_org_ids   uuid[]   (for agent invites only — every org the agent
--                             will be assigned to via agent_org_assignments
--                             at signup time)
--
-- On signup (auth.users INSERT), handle_new_user branches:
--   - invite_type='member' → existing behaviour (insert team_members row).
--   - invite_type='agent'  → grant 'agent' role in user_roles AND insert
--                            agent_org_assignments rows for every org in
--                            agent_org_ids. The agent never joins a team.
--
-- send-invitation edge function will be updated separately to accept these
-- params and require system_admin caller for invite_type='agent'.

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS invite_type text NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS agent_org_ids uuid[];

ALTER TABLE public.invitations
  DROP CONSTRAINT IF EXISTS invitations_invite_type_chk;
ALTER TABLE public.invitations
  ADD CONSTRAINT invitations_invite_type_chk CHECK (invite_type IN ('member','agent'));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _org_name text; _org_id uuid; _team_id uuid; _is_first boolean := false;
  _invite_token text; _invite record; _cs_agent_id uuid;
  _default_perms jsonb := '["screens","media","schedules","publish","studio"]'::jsonb;
  _assign_org_id uuid;
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'));

  _cs_agent_id := (NEW.raw_user_meta_data->>'cs_agent')::uuid;
  IF _cs_agent_id IS NOT NULL THEN
    UPDATE public.cs_agents SET user_id = NEW.id, status = 'active', updated_at = now()
    WHERE id = _cs_agent_id AND lower(email) = lower(NEW.email) AND status = 'invited';
    IF FOUND THEN RETURN NEW; END IF;
  END IF;

  IF _cs_agent_id IS NULL THEN
    UPDATE public.cs_agents SET user_id = NEW.id, status = 'active', updated_at = now()
    WHERE lower(email) = lower(NEW.email) AND status = 'invited' AND user_id IS NULL;
    IF FOUND THEN RETURN NEW; END IF;
  END IF;

  _invite_token := trim(NEW.raw_user_meta_data->>'invite_token');
  IF _invite_token IS NOT NULL AND _invite_token != '' THEN
    SELECT i.id, i.org_id, i.invite_type, i.agent_org_ids, i.invited_by
      INTO _invite FROM public.invitations i
     WHERE i.token = _invite_token
       AND i.status = 'pending'
       AND i.expires_at > now()
       AND lower(i.email) = lower(NEW.email)
     LIMIT 1;
    IF _invite.id IS NOT NULL THEN
      UPDATE public.invitations SET status = 'accepted' WHERE id = _invite.id;

      IF _invite.invite_type = 'agent' THEN
        -- Agent invite: grant role + multi-org visibility, no team membership.
        INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'agent')
          ON CONFLICT DO NOTHING;
        IF _invite.agent_org_ids IS NOT NULL THEN
          FOREACH _assign_org_id IN ARRAY _invite.agent_org_ids LOOP
            INSERT INTO public.agent_org_assignments (agent_user_id, org_id, assigned_by)
            VALUES (NEW.id, _assign_org_id, _invite.invited_by)
            ON CONFLICT DO NOTHING;
          END LOOP;
        END IF;
        RETURN NEW;
      END IF;

      -- Member invite (legacy path): join the org's default team.
      SELECT id INTO _team_id FROM public.teams WHERE org_id = _invite.org_id LIMIT 1;
      IF _team_id IS NULL THEN
        INSERT INTO public.teams (org_id, name, description, created_by, permissions)
        VALUES (_invite.org_id, 'Default', 'Default team', NEW.id, _default_perms)
        RETURNING id INTO _team_id;
      END IF;
      INSERT INTO public.team_members (team_id, user_id, role) VALUES (_team_id, NEW.id, 'member');
      RETURN NEW;
    END IF;
  END IF;

  _org_name := trim(NEW.raw_user_meta_data->>'org_name');
  IF _org_name IS NOT NULL AND _org_name != '' THEN
    SELECT id INTO _org_id FROM public.organizations WHERE lower(name) = lower(_org_name) LIMIT 1;
    IF _org_id IS NULL THEN
      INSERT INTO public.organizations (name, created_by) VALUES (_org_name, NEW.id) RETURNING id INTO _org_id;
      _is_first := true;
    END IF;
    SELECT id INTO _team_id FROM public.teams WHERE org_id = _org_id LIMIT 1;
    IF _team_id IS NULL THEN
      INSERT INTO public.teams (org_id, name, description, created_by, permissions)
      VALUES (_org_id, 'Default', 'Default team', NEW.id, _default_perms)
      RETURNING id INTO _team_id;
    END IF;
    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_team_id, NEW.id, CASE WHEN _is_first THEN 'admin' ELSE 'member' END);
    IF _is_first THEN INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_admin'); END IF;
  END IF;
  RETURN NEW;
END;
$function$;
