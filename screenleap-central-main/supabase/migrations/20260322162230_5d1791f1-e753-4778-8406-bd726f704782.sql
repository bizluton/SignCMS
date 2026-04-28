
CREATE TABLE public.iot_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.organizations(id),
  name text NOT NULL,
  device_type text NOT NULL DEFAULT 'air_quality',
  status text NOT NULL DEFAULT 'offline',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.iot_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage iot_devices" ON public.iot_devices FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can view iot_devices in their org" ON public.iot_devices FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'::app_role) OR org_id IS NULL OR user_in_org(auth.uid(), org_id));
