
-- ==================== screens ====================

-- INSERT
DROP POLICY IF EXISTS "Admins can insert screens" ON public.screens;
CREATE POLICY "Authorized users can insert screens"
  ON public.screens FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- UPDATE
DROP POLICY IF EXISTS "Admins can update screens" ON public.screens;
CREATE POLICY "Authorized users can update screens"
  ON public.screens FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- DELETE
DROP POLICY IF EXISTS "Admins can delete screens" ON public.screens;
CREATE POLICY "Authorized users can delete screens"
  ON public.screens FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- ==================== media_items ====================

-- INSERT
DROP POLICY IF EXISTS "Admins can insert media" ON public.media_items;
CREATE POLICY "Authorized users can insert media"
  ON public.media_items FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- DELETE
DROP POLICY IF EXISTS "Admins can delete media" ON public.media_items;
CREATE POLICY "Authorized users can delete media"
  ON public.media_items FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- ==================== screen_logs ====================

-- INSERT
DROP POLICY IF EXISTS "Admins can insert screen logs" ON public.screen_logs;
CREATE POLICY "Authorized users can insert screen logs"
  ON public.screen_logs FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- DELETE
DROP POLICY IF EXISTS "Admins can delete screen logs" ON public.screen_logs;
CREATE POLICY "Authorized users can delete screen logs"
  ON public.screen_logs FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );
