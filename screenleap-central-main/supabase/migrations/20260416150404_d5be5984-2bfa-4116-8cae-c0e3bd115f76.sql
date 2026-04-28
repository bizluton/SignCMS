
-- Update SELECT: creator OR org members OR admin
DROP POLICY IF EXISTS "Users can view own design projects" ON public.design_projects;
CREATE POLICY "Users can view accessible design projects"
  ON public.design_projects FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
  );

-- Update UPDATE: creator OR org_admin in same org OR admin
DROP POLICY IF EXISTS "Users can update own design projects" ON public.design_projects;
CREATE POLICY "Users can update accessible design projects"
  ON public.design_projects FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- Update DELETE: creator OR admin (org_admin cannot delete others' projects)
DROP POLICY IF EXISTS "Users can delete own design projects" ON public.design_projects;
CREATE POLICY "Users can delete own design projects"
  ON public.design_projects FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
  );
