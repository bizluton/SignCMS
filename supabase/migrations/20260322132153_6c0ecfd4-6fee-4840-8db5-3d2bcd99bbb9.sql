
-- Update SELECT policy on screens to filter by org for non-admins
DROP POLICY IF EXISTS "Authenticated users can view screens" ON public.screens;
CREATE POLICY "Users can view screens in their org or admins see all"
  ON public.screens FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR org_id IS NULL
    OR public.user_in_org(auth.uid(), org_id)
  );

-- Update SELECT policy on media_items to filter by org for non-admins
DROP POLICY IF EXISTS "Authenticated users can view media" ON public.media_items;
CREATE POLICY "Users can view media in their org or admins see all"
  ON public.media_items FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR org_id IS NULL
    OR public.user_in_org(auth.uid(), org_id)
  );

-- Update SELECT policy on schedules
DROP POLICY IF EXISTS "Authenticated users can view schedules" ON public.schedules;
CREATE POLICY "Users can view schedules in their org or admins see all"
  ON public.schedules FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR org_id IS NULL
    OR public.user_in_org(auth.uid(), org_id)
  );

-- Update SELECT policy on schedule_items (join through schedule)
DROP POLICY IF EXISTS "Authenticated users can view schedule items" ON public.schedule_items;
CREATE POLICY "Users can view schedule items in their org or admins see all"
  ON public.schedule_items FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.schedules s 
      WHERE s.id = schedule_id 
      AND (s.org_id IS NULL OR public.user_in_org(auth.uid(), s.org_id))
    )
  );
