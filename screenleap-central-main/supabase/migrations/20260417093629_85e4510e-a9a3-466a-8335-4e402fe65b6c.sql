ALTER TABLE public.iot_devices ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.screen_logs ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.iot_sensor_readings ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.playback_logs ALTER COLUMN org_id SET NOT NULL;