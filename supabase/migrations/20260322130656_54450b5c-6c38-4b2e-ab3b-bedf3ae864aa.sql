
-- 1. Create organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Create teams table
CREATE TABLE public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- 3. Create team_members table
CREATE TABLE public.team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- 4. Add org_id to existing tables for data isolation
ALTER TABLE public.screens ADD COLUMN org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.media_items ADD COLUMN org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.schedules ADD COLUMN org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE public.design_projects ADD COLUMN org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 5. Helper function: get user's org_ids
CREATE OR REPLACE FUNCTION public.get_user_org_ids(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT t.org_id
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id
  WHERE tm.user_id = _user_id
$$;

-- 6. Helper function: check if user belongs to org
CREATE OR REPLACE FUNCTION public.user_in_org(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.team_members tm
    JOIN public.teams t ON t.id = tm.team_id
    WHERE tm.user_id = _user_id AND t.org_id = _org_id
  )
$$;

-- 7. RLS policies for organizations
CREATE POLICY "Users can view their organizations"
  ON public.organizations FOR SELECT TO authenticated
  USING (public.user_in_org(auth.uid(), id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert organizations"
  ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update organizations"
  ON public.organizations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete organizations"
  ON public.organizations FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 8. RLS policies for teams
CREATE POLICY "Users can view teams in their org"
  ON public.teams FOR SELECT TO authenticated
  USING (public.user_in_org(auth.uid(), org_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert teams"
  ON public.teams FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update teams"
  ON public.teams FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete teams"
  ON public.teams FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 9. RLS policies for team_members
CREATE POLICY "Users can view members in their org teams"
  ON public.team_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_id AND (public.user_in_org(auth.uid(), t.org_id) OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Admins can insert team members"
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update team members"
  ON public.team_members FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete team members"
  ON public.team_members FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 10. Update triggers for updated_at
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
