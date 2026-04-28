INSERT INTO storage.buckets (id, name, public)
VALUES ('screen-health-reports', 'screen-health-reports', false)
ON CONFLICT (id) DO NOTHING;

-- Members can read files for their org (folder = org_id)
DROP POLICY IF EXISTS "shr_select_org_members" ON storage.objects;
CREATE POLICY "shr_select_org_members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'screen-health-reports'
  AND (
    public.is_system_admin(auth.uid())
    OR public.user_in_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

-- Service role uploads only (the dispatcher)
DROP POLICY IF EXISTS "shr_insert_service" ON storage.objects;
CREATE POLICY "shr_insert_service"
ON storage.objects FOR INSERT TO public
WITH CHECK (
  bucket_id = 'screen-health-reports'
  AND auth.role() = 'service_role'
);

-- Org/system admins may delete (cleanup)
DROP POLICY IF EXISTS "shr_delete_admin" ON storage.objects;
CREATE POLICY "shr_delete_admin"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'screen-health-reports'
  AND (
    public.is_system_admin(auth.uid())
    OR (
      public.user_in_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
      AND public.is_org_admin(auth.uid())
    )
  )
);