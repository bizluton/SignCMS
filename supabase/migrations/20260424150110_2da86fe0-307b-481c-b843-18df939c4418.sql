-- Schedule table
CREATE TABLE public.screen_health_report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cadence text NOT NULL CHECK (cadence IN ('daily','weekly')),
  hour_utc smallint NOT NULL DEFAULT 8 CHECK (hour_utc BETWEEN 0 AND 23),
  day_of_week smallint NULL CHECK (day_of_week IS NULL OR day_of_week BETWEEN 0 AND 6),
  recipients text[] NOT NULL DEFAULT '{}'::text[],
  include_offline_only boolean NOT NULL DEFAULT false,
  time_range_hours integer NOT NULL DEFAULT 24 CHECK (time_range_hours BETWEEN 1 AND 720),
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz NULL,
  last_status text NULL,
  last_error text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shrs_org ON public.screen_health_report_schedules(org_id);
CREATE INDEX idx_shrs_enabled ON public.screen_health_report_schedules(enabled) WHERE enabled = true;

ALTER TABLE public.screen_health_report_schedules ENABLE ROW LEVEL SECURITY;

-- Helper: is system admin
CREATE OR REPLACE FUNCTION public.is_system_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(SELECT 1 FROM public.system_admins WHERE user_id = _user_id);
$$;

-- Org admin OR system admin can manage schedules within their org
CREATE POLICY "Admins can view org schedules"
ON public.screen_health_report_schedules
FOR SELECT TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR public.is_org_admin(auth.uid())
);

CREATE POLICY "Admins can insert org schedules"
ON public.screen_health_report_schedules
FOR INSERT TO authenticated
WITH CHECK (
  public.is_system_admin(auth.uid())
  OR public.is_org_admin(auth.uid())
);

CREATE POLICY "Admins can update org schedules"
ON public.screen_health_report_schedules
FOR UPDATE TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR public.is_org_admin(auth.uid())
);

CREATE POLICY "Admins can delete org schedules"
ON public.screen_health_report_schedules
FOR DELETE TO authenticated
USING (
  public.is_system_admin(auth.uid())
  OR public.is_org_admin(auth.uid())
);

-- updated_at trigger
CREATE TRIGGER trg_shrs_updated_at
BEFORE UPDATE ON public.screen_health_report_schedules
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();