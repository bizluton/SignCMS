-- Add team_id and collab_scope to design_projects.
-- These columns are used by Content Studio to scope project visibility
-- per team and control collaboration access level.

ALTER TABLE public.design_projects
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS collab_scope TEXT DEFAULT 'creator'
    CHECK (collab_scope IN ('creator', 'team', 'org'));

CREATE INDEX IF NOT EXISTS idx_design_projects_team_id
  ON public.design_projects(team_id);

CREATE INDEX IF NOT EXISTS idx_design_projects_org_id
  ON public.design_projects(org_id);
