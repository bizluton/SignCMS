-- 1. Update handle_new_user: first org user gets org_admin instead of admin
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_name text;
  _org_id uuid;
  _team_id uuid;
  _is_first boolean := false;
  _invite_token text;
  _invite_org_id uuid;
  _cs_agent_id uuid;
BEGIN
  INSERT INTO public.profiles (user_id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture')
  );

  _cs_agent_id := (NEW.raw_user_meta_data->>'cs_agent')::uuid;
  IF _cs_agent_id IS NOT NULL THEN
    UPDATE public.cs_agents
    SET user_id = NEW.id, status = 'active', updated_at = now()
    WHERE id = _cs_agent_id
      AND lower(email) = lower(NEW.email)
      AND status = 'invited';
    RETURN NEW;
  END IF;

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
      INSERT INTO public.teams (org_id, name, description, created_by)
      VALUES (_org_id, 'Default', 'Default team', NEW.id) RETURNING id INTO _team_id;
    END IF;

    INSERT INTO public.team_members (team_id, user_id, role)
    VALUES (_team_id, NEW.id, CASE WHEN _is_first THEN 'admin' ELSE 'member' END);

    IF _is_first THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'org_admin');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2. Add is_org_admin helper
CREATE OR REPLACE FUNCTION public.is_org_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'org_admin'
  )
$$;

-- 3. Organizations: org_admin can insert and update own org
DROP POLICY IF EXISTS "Admins can insert organizations" ON public.organizations;
CREATE POLICY "Admins can insert organizations" ON public.organizations
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'org_admin'));

DROP POLICY IF EXISTS "Admins can update organizations" ON public.organizations;
CREATE POLICY "Admins can update organizations" ON public.organizations
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), id)));

DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;
CREATE POLICY "Users can view their organizations" ON public.organizations
  FOR SELECT TO authenticated
  USING (user_in_org(auth.uid(), id) OR has_role(auth.uid(), 'admin'));

-- 4. Teams: org_admin can manage own org teams
DROP POLICY IF EXISTS "Admins can insert teams" ON public.teams;
CREATE POLICY "Admins or org_admins can insert teams" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

DROP POLICY IF EXISTS "Admins can update teams" ON public.teams;
CREATE POLICY "Admins or org_admins can update teams" ON public.teams
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

DROP POLICY IF EXISTS "Admins can delete teams" ON public.teams;
CREATE POLICY "Admins or org_admins can delete teams" ON public.teams
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

-- 5. Team members: org_admin can manage members in own org
DROP POLICY IF EXISTS "Admins can insert team members" ON public.team_members;
CREATE POLICY "Admins or org_admins can insert team members" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND user_in_org(auth.uid(), t.org_id)
  )));

DROP POLICY IF EXISTS "Admins can update team members" ON public.team_members;
CREATE POLICY "Admins or org_admins can update team members" ON public.team_members
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND user_in_org(auth.uid(), t.org_id)
  )));

DROP POLICY IF EXISTS "Admins can delete team members" ON public.team_members;
CREATE POLICY "Admins or org_admins can delete team members" ON public.team_members
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR (has_role(auth.uid(), 'org_admin') AND EXISTS (
    SELECT 1 FROM public.teams t WHERE t.id = team_members.team_id AND user_in_org(auth.uid(), t.org_id)
  )));

-- 6. Invitations: org_admin can manage own org invitations
DROP POLICY IF EXISTS "System admin can insert invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can insert invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7' OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

DROP POLICY IF EXISTS "System admin can view invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can view invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7' OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

DROP POLICY IF EXISTS "System admin can delete invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can delete invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7' OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id)));

-- 7. Activity logs: org_admin can view org logs
CREATE POLICY "Org admins can view org activity logs" ON public.activity_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'org_admin') AND org_id IS NOT NULL AND user_in_org(auth.uid(), org_id));

-- 8. User roles: org_admin can view roles of users in their org
CREATE POLICY "Org admins can view org user roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'org_admin') AND EXISTS (
    SELECT 1 FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = user_roles.user_id
      AND user_in_org(auth.uid(), t.org_id)
  ));