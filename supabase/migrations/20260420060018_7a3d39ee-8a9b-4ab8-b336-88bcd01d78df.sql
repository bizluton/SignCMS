DROP POLICY IF EXISTS "Users can view their organizations" ON public.organizations;

CREATE POLICY "Users can view their organizations"
ON public.organizations
FOR SELECT
TO authenticated
USING (
  user_in_org(auth.uid(), id)
  OR has_role(auth.uid(), 'admin'::app_role)
  OR is_system_admin(auth.uid())
);