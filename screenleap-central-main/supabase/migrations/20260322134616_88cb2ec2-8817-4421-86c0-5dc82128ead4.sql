-- Create screen_logs table for device status logging
CREATE TABLE public.screen_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screen_id uuid REFERENCES public.screens(id) ON DELETE CASCADE NOT NULL,
  org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  event_type text NOT NULL DEFAULT 'system',
  event_title text NOT NULL,
  event_detail text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT NULL
);

-- Enable RLS
ALTER TABLE public.screen_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view logs in their org or admins see all"
  ON public.screen_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR org_id IS NULL OR user_in_org(auth.uid(), org_id));

CREATE POLICY "Admins can insert screen logs"
  ON public.screen_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete screen logs"
  ON public.screen_logs FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Index for fast lookups
CREATE INDEX idx_screen_logs_screen_id ON public.screen_logs(screen_id);
CREATE INDEX idx_screen_logs_created_at ON public.screen_logs(created_at DESC);
CREATE INDEX idx_screen_logs_event_type ON public.screen_logs(event_type);