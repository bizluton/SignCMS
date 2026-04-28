-- Tighten SELECT policy on publish_records to scope by organization
DROP POLICY IF EXISTS "Authenticated users can view publish records" ON public.publish_records;

CREATE POLICY "Org members can view publish records"
ON public.publish_records
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (
    schedule_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.schedules s
      WHERE s.id = publish_records.schedule_id
        AND s.org_id IS NOT NULL
        AND user_in_org(auth.uid(), s.org_id)
    )
  )
  OR (
    screen_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.screens sc
      WHERE sc.id = publish_records.screen_id
        AND sc.org_id IS NOT NULL
        AND user_in_org(auth.uid(), sc.org_id)
    )
  )
);