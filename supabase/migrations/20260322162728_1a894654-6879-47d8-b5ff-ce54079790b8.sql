
CREATE TABLE public.iot_sensor_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES public.iot_devices(id) ON DELETE CASCADE,
  screen_id uuid NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id),
  value numeric NOT NULL,
  unit text NOT NULL DEFAULT '',
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sensor_readings_device_time ON public.iot_sensor_readings(device_id, recorded_at DESC);
CREATE INDEX idx_sensor_readings_screen_time ON public.iot_sensor_readings(screen_id, recorded_at DESC);

ALTER TABLE public.iot_sensor_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sensor readings" ON public.iot_sensor_readings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view sensor readings in their org" ON public.iot_sensor_readings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR org_id IS NULL OR user_in_org(auth.uid(), org_id));

CREATE POLICY "Authenticated can insert sensor readings" ON public.iot_sensor_readings
  FOR INSERT TO authenticated
  WITH CHECK (true);

ALTER PUBLICATION supabase_realtime ADD TABLE public.iot_sensor_readings;
