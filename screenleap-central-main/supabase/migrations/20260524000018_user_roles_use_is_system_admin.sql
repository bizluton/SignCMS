-- The user_roles INSERT / DELETE / UPDATE policies were locked to a single
-- hardcoded UUID (service@signcms.net). After today's permission rebuild
-- both service@bizlution.com and service@signcms.net are root system admins
-- and should be able to manage roles; any future non-root system admin too.
-- Replace the hardcoded UUID with is_system_admin(auth.uid()).
--
-- Symptom this fixes: AdminPage's "Change role" dialog produced
-- "new row violates row-level security policy for table 'user_roles'"
-- when a system admin other than service@signcms.net tried to promote a
-- user to 組織管理員.

DROP POLICY IF EXISTS "System admin can insert roles" ON public.user_roles;
CREATE POLICY "System admin can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_system_admin(auth.uid()));

DROP POLICY IF EXISTS "System admin can delete roles" ON public.user_roles;
CREATE POLICY "System admin can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.is_system_admin(auth.uid()));

DROP POLICY IF EXISTS "System admin can update roles" ON public.user_roles;
CREATE POLICY "System admin can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));
