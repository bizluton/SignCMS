-- screens
DROP POLICY IF EXISTS "Users can view screens in their org or admins see all" ON public.screens;
DROP POLICY IF EXISTS "Users can view screens" ON public.screens;
CREATE POLICY "Users can view screens in their org"
ON public.screens FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- iot_devices
DROP POLICY IF EXISTS "Users can view iot_devices in their org" ON public.iot_devices;
CREATE POLICY "Users can view iot_devices in their org"
ON public.iot_devices FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- iot_sensor_readings
DROP POLICY IF EXISTS "Users can view sensor readings in their org" ON public.iot_sensor_readings;
CREATE POLICY "Users can view sensor readings in their org"
ON public.iot_sensor_readings FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- media_items
DROP POLICY IF EXISTS "Users can view media in their org or admins see all" ON public.media_items;
CREATE POLICY "Users can view media in their org"
ON public.media_items FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- schedules
DROP POLICY IF EXISTS "Users can view schedules in their org or admins see all" ON public.schedules;
DROP POLICY IF EXISTS "Users can view schedules" ON public.schedules;
CREATE POLICY "Users can view schedules in their org"
ON public.schedules FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- screen_logs
DROP POLICY IF EXISTS "Users can view screen_logs in their org or admins see all" ON public.screen_logs;
DROP POLICY IF EXISTS "Users can view screen logs in their org or admins see all" ON public.screen_logs;
CREATE POLICY "Users can view screen logs in their org"
ON public.screen_logs FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));

-- playback_logs
DROP POLICY IF EXISTS "Users can view playback logs in their org or admins see all" ON public.playback_logs;
CREATE POLICY "Users can view playback logs in their org"
ON public.playback_logs FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR ((org_id IS NOT NULL) AND user_in_org(auth.uid(), org_id)));