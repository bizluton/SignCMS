-- Tracks system/app widgets that have been hidden for a specific org.
-- The widget row itself is NOT deleted; this is a soft-exclusion per org.
CREATE TABLE IF NOT EXISTS public.widget_org_exclusions (
  widget_id  uuid NOT NULL REFERENCES public.widgets(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (widget_id, org_id)
);

ALTER TABLE public.widget_org_exclusions ENABLE ROW LEVEL SECURITY;

-- Org members need to read their org's exclusion list so the widget hook can filter
CREATE POLICY "Org members can view their exclusions"
  ON public.widget_org_exclusions FOR SELECT TO authenticated
  USING (
    public.user_in_org(auth.uid(), org_id)
    OR has_role(auth.uid(), 'admin'::app_role)
  );

-- Only system admins can create or remove exclusions
CREATE POLICY "System admin manages exclusions"
  ON public.widget_org_exclusions FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System admin removes exclusions"
  ON public.widget_org_exclusions FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
