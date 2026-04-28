
-- Update INSERT: allow org_admin to create projects (must set org_id to their org)
DROP POLICY IF EXISTS "Users can insert own design projects" ON public.design_projects;
CREATE POLICY "Users can insert own design projects"
  ON public.design_projects FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR has_role(auth.uid(), 'org_admin'::app_role)
      OR user_in_org(auth.uid(), org_id)
    )
  );

-- Update DELETE: allow org_admin to delete projects in their org
DROP POLICY IF EXISTS "Users can delete own design projects" ON public.design_projects;
CREATE POLICY "Users can delete own design projects"
  ON public.design_projects FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );
