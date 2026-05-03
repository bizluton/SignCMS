-- Allow developers to read their own submissions (regardless of status)
CREATE POLICY "submitter_read_own_apps"
  ON public.store_apps FOR SELECT
  TO authenticated
  USING (submitted_by = auth.uid());
