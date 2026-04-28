
CREATE POLICY "Authorized users can update media"
  ON public.media_items FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR (org_id IS NOT NULL AND user_in_org(auth.uid(), org_id) AND is_org_admin(auth.uid()))
  );
