-- Allow regular org members (user role) to manage media and schedules within their org
-- Screens remain restricted to admin / org_admin

-- ============ media_items ============
DROP POLICY IF EXISTS "Authorized users can insert media" ON public.media_items;
DROP POLICY IF EXISTS "Authorized users can update media" ON public.media_items;
DROP POLICY IF EXISTS "Authorized users can delete media" ON public.media_items;

CREATE POLICY "Org members can insert media"
ON public.media_items FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

CREATE POLICY "Org members can update media"
ON public.media_items FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

CREATE POLICY "Org members can delete media"
ON public.media_items FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

-- ============ schedules ============
DROP POLICY IF EXISTS "Authorized users can insert schedules" ON public.schedules;
DROP POLICY IF EXISTS "Authorized users can update schedules" ON public.schedules;
DROP POLICY IF EXISTS "Authorized users can delete schedules" ON public.schedules;

CREATE POLICY "Org members can insert schedules"
ON public.schedules FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

CREATE POLICY "Org members can update schedules"
ON public.schedules FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

CREATE POLICY "Org members can delete schedules"
ON public.schedules FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id))
);

-- ============ schedule_items (children of schedules) ============
DROP POLICY IF EXISTS "Authorized users can insert schedule items" ON public.schedule_items;
DROP POLICY IF EXISTS "Authorized users can update schedule items" ON public.schedule_items;
DROP POLICY IF EXISTS "Authorized users can delete schedule items" ON public.schedule_items;

CREATE POLICY "Org members can insert schedule items"
ON public.schedule_items FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_items.schedule_id
      AND s.org_id IS NOT NULL
      AND user_in_org(auth.uid(), s.org_id)
  )
);

CREATE POLICY "Org members can update schedule items"
ON public.schedule_items FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_items.schedule_id
      AND s.org_id IS NOT NULL
      AND user_in_org(auth.uid(), s.org_id)
  )
);

CREATE POLICY "Org members can delete schedule items"
ON public.schedule_items FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = schedule_items.schedule_id
      AND s.org_id IS NOT NULL
      AND user_in_org(auth.uid(), s.org_id)
  )
);