-- Add explicit policies so RLS-enabled table is no longer flagged
DROP POLICY IF EXISTS "System admins can view cleanup settings" ON public.schedule_cleanup_settings;
DROP POLICY IF EXISTS "System admins can update cleanup settings" ON public.schedule_cleanup_settings;
DROP POLICY IF EXISTS "System admins can insert cleanup settings" ON public.schedule_cleanup_settings;

CREATE POLICY "System admins can view cleanup settings"
  ON public.schedule_cleanup_settings
  FOR SELECT
  TO authenticated
  USING (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can update cleanup settings"
  ON public.schedule_cleanup_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_system_admin(auth.uid()))
  WITH CHECK (public.is_system_admin(auth.uid()));

CREATE POLICY "System admins can insert cleanup settings"
  ON public.schedule_cleanup_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_system_admin(auth.uid()));