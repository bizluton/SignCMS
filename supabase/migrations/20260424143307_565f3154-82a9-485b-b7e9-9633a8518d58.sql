-- Screen offline alerts: track acknowledge/resolve state for offline screens
CREATE TABLE public.screen_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  screen_id UUID NOT NULL REFERENCES public.screens(id) ON DELETE CASCADE,
  org_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'acknowledged' | 'resolved'
  detected_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMP WITH TIME ZONE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_screen_alerts_screen ON public.screen_alerts(screen_id);
CREATE INDEX idx_screen_alerts_org_status ON public.screen_alerts(org_id, status);
-- Only one active alert per screen at a time
CREATE UNIQUE INDEX idx_screen_alerts_one_active
  ON public.screen_alerts(screen_id) WHERE status = 'active';

ALTER TABLE public.screen_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "screen_alerts_select_org"
  ON public.screen_alerts FOR SELECT TO authenticated
  USING (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "screen_alerts_insert_org"
  ON public.screen_alerts FOR INSERT TO authenticated
  WITH CHECK (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "screen_alerts_update_org_admin"
  ON public.screen_alerts FOR UPDATE TO authenticated
  USING (is_system_admin(auth.uid()) OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))))
  WITH CHECK (is_system_admin(auth.uid()) OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role))));

CREATE POLICY "screen_alerts_delete_admin"
  ON public.screen_alerts FOR DELETE TO authenticated
  USING (is_system_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_screen_alerts_updated
  BEFORE UPDATE ON public.screen_alerts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();