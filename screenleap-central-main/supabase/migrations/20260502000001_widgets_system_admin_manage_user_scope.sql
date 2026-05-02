-- System admin can INSERT user-scope widgets for any org (they are not org members)
CREATE POLICY "System admin can insert user widgets"
  ON public.widgets FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    AND scope = 'user'
    AND org_id IS NOT NULL
  );

-- System admin can UPDATE user-scope widgets for any org
CREATE POLICY "System admin can update user widgets"
  ON public.widgets FOR UPDATE
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    AND scope = 'user'
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    AND scope = 'user'
    AND org_id IS NOT NULL
  );

-- System admin can DELETE user-scope widgets for any org
CREATE POLICY "System admin can delete user widgets"
  ON public.widgets FOR DELETE
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    AND scope = 'user'
  );
