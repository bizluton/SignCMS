-- Invitations RLS policies were missing the 'admin' role, so only users with
-- the 'org_admin' role (plus the hardcoded system-admin UUID) could see, insert
-- or delete invitation rows. Regular org admins with role='admin' got empty results.
--
-- Fix: add has_role(auth.uid(), 'admin') alongside has_role(..., 'org_admin').
-- Also replace the hardcoded UUID with is_system_admin() for consistency.

DROP POLICY IF EXISTS "Admin or org_admin can insert invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can insert invitations" ON public.invitations
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_system_admin(auth.uid())
    OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id))
    OR (has_role(auth.uid(), 'admin')     AND user_in_org(auth.uid(), org_id))
  );

DROP POLICY IF EXISTS "Admin or org_admin can view invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can view invitations" ON public.invitations
  FOR SELECT TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id))
    OR (has_role(auth.uid(), 'admin')     AND user_in_org(auth.uid(), org_id))
  );

DROP POLICY IF EXISTS "Admin or org_admin can delete invitations" ON public.invitations;
CREATE POLICY "Admin or org_admin can delete invitations" ON public.invitations
  FOR DELETE TO authenticated
  USING (
    public.is_system_admin(auth.uid())
    OR (has_role(auth.uid(), 'org_admin') AND user_in_org(auth.uid(), org_id))
    OR (has_role(auth.uid(), 'admin')     AND user_in_org(auth.uid(), org_id))
  );
