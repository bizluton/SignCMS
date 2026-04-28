-- Restrict user_roles mutations to system admin only
DROP POLICY IF EXISTS "Admins can insert roles" ON public.user_roles;
CREATE POLICY "System admin can insert roles"
  ON public.user_roles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

DROP POLICY IF EXISTS "Admins can update roles" ON public.user_roles;
CREATE POLICY "System admin can update roles"
  ON public.user_roles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

DROP POLICY IF EXISTS "Admins can delete roles" ON public.user_roles;
CREATE POLICY "System admin can delete roles"
  ON public.user_roles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

-- Also allow service_role for the trigger (handle_new_user_role)
CREATE POLICY "Service role can insert roles"
  ON public.user_roles
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- Restrict invitations to system admin only
DROP POLICY IF EXISTS "Admins can insert invitations" ON public.invitations;
CREATE POLICY "System admin can insert invitations"
  ON public.invitations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

DROP POLICY IF EXISTS "Admins can delete invitations" ON public.invitations;
CREATE POLICY "System admin can delete invitations"
  ON public.invitations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);

DROP POLICY IF EXISTS "Admins can view invitations" ON public.invitations;
CREATE POLICY "System admin can view invitations"
  ON public.invitations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);