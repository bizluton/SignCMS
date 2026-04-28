-- Add collab_scope column to design_projects to control collaboration visibility
ALTER TABLE public.design_projects
  ADD COLUMN IF NOT EXISTS collab_scope text NOT NULL DEFAULT 'creator';

ALTER TABLE public.design_projects
  DROP CONSTRAINT IF EXISTS design_projects_collab_scope_check;
ALTER TABLE public.design_projects
  ADD CONSTRAINT design_projects_collab_scope_check
  CHECK (collab_scope IN ('creator', 'team', 'org'));

-- Replace SELECT policy to honor collab_scope
DROP POLICY IF EXISTS "Users can view accessible design projects" ON public.design_projects;

CREATE POLICY "Users can view accessible design projects"
ON public.design_projects
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR (
    org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND (
      is_org_admin(auth.uid())
      OR collab_scope = 'org'
      OR (
        collab_scope = 'team'
        AND team_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = design_projects.team_id
            AND tm.user_id = auth.uid()
        )
      )
    )
  )
);