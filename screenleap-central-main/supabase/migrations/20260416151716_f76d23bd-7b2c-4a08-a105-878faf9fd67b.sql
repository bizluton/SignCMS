
-- ==================== schedules ====================

-- INSERT: admin or org_admin in their org
DROP POLICY IF EXISTS "Admins can insert schedules" ON public.schedules;
CREATE POLICY "Authorized users can insert schedules"
  ON public.schedules FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- UPDATE: admin or org_admin in their org
DROP POLICY IF EXISTS "Admins can update schedules" ON public.schedules;
CREATE POLICY "Authorized users can update schedules"
  ON public.schedules FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- DELETE: admin or org_admin in their org
DROP POLICY IF EXISTS "Admins can delete schedules" ON public.schedules;
CREATE POLICY "Authorized users can delete schedules"
  ON public.schedules FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );

-- ==================== schedule_items ====================

-- INSERT: admin or org_admin via schedule's org
DROP POLICY IF EXISTS "Admins can insert schedule items" ON public.schedule_items;
CREATE POLICY "Authorized users can insert schedule items"
  ON public.schedule_items FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_items.schedule_id
        AND s.org_id IS NOT NULL
        AND user_in_org(auth.uid(), s.org_id)
        AND is_org_admin(auth.uid())
    )
  );

-- UPDATE: admin or org_admin via schedule's org
DROP POLICY IF EXISTS "Admins can update schedule items" ON public.schedule_items;
CREATE POLICY "Authorized users can update schedule items"
  ON public.schedule_items FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_items.schedule_id
        AND s.org_id IS NOT NULL
        AND user_in_org(auth.uid(), s.org_id)
        AND is_org_admin(auth.uid())
    )
  );

-- DELETE: admin or org_admin via schedule's org
DROP POLICY IF EXISTS "Admins can delete schedule items" ON public.schedule_items;
CREATE POLICY "Authorized users can delete schedule items"
  ON public.schedule_items FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = schedule_items.schedule_id
        AND s.org_id IS NOT NULL
        AND user_in_org(auth.uid(), s.org_id)
        AND is_org_admin(auth.uid())
    )
  );

-- ==================== publish_records ====================

-- INSERT: admin or org_admin (check via schedule's org)
DROP POLICY IF EXISTS "Admins can insert publish records" ON public.publish_records;
CREATE POLICY "Authorized users can insert publish records"
  ON public.publish_records FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      schedule_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.schedules s
        WHERE s.id = publish_records.schedule_id
          AND s.org_id IS NOT NULL
          AND user_in_org(auth.uid(), s.org_id)
          AND is_org_admin(auth.uid())
      )
    )
    OR is_org_admin(auth.uid())
  );

-- UPDATE: admin or org_admin
DROP POLICY IF EXISTS "Admins can update publish records" ON public.publish_records;
CREATE POLICY "Authorized users can update publish records"
  ON public.publish_records FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      schedule_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.schedules s
        WHERE s.id = publish_records.schedule_id
          AND s.org_id IS NOT NULL
          AND user_in_org(auth.uid(), s.org_id)
          AND is_org_admin(auth.uid())
      )
    )
    OR is_org_admin(auth.uid())
  );

-- DELETE: admin or org_admin
DROP POLICY IF EXISTS "Admins can delete publish records" ON public.publish_records;
CREATE POLICY "Authorized users can delete publish records"
  ON public.publish_records FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (
      schedule_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.schedules s
        WHERE s.id = publish_records.schedule_id
          AND s.org_id IS NOT NULL
          AND user_in_org(auth.uid(), s.org_id)
          AND is_org_admin(auth.uid())
      )
    )
    OR is_org_admin(auth.uid())
  );
