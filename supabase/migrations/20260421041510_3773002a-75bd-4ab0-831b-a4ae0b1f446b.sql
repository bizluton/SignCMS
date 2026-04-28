DROP POLICY IF EXISTS channel_allowed_projects_modify_org_admin ON public.channel_allowed_projects;

CREATE POLICY channel_allowed_projects_modify_org_admin
ON public.channel_allowed_projects
FOR ALL
TO authenticated
USING (
  is_system_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.channels c
    WHERE c.id = channel_allowed_projects.channel_id
      AND user_in_org(auth.uid(), c.org_id)
      AND (
        is_org_admin(auth.uid())
        OR has_role(auth.uid(), 'admin'::app_role)
      )
  )
)
WITH CHECK (
  is_system_admin(auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.channels c
    WHERE c.id = channel_allowed_projects.channel_id
      AND user_in_org(auth.uid(), c.org_id)
      AND (
        is_org_admin(auth.uid())
        OR has_role(auth.uid(), 'admin'::app_role)
      )
  )
);