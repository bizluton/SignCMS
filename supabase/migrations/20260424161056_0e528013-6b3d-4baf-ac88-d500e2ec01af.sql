-- Per-org default timezone
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- Per-schedule timezone (overrides org default). Defaults to org's timezone on insert via trigger.
ALTER TABLE public.screen_health_report_schedules
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- Rename hour_utc semantics: it now means "hour in the schedule's timezone".
-- Keep column name to avoid breaking existing code/types; add a comment to document.
COMMENT ON COLUMN public.screen_health_report_schedules.hour_utc
  IS 'Hour of day (0-23) in the schedule''s timezone. Name is legacy; interpret with the timezone column.';
COMMENT ON COLUMN public.screen_health_report_schedules.timezone
  IS 'IANA timezone (e.g. Asia/Taipei). DST-aware: dispatcher resolves local hour/dow at run time.';
COMMENT ON COLUMN public.organizations.timezone
  IS 'Default IANA timezone for the organization. Used as fallback for schedules and reports.';

-- Trigger: when a schedule is inserted without an explicit timezone, inherit from org.
CREATE OR REPLACE FUNCTION public.shrs_default_timezone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.timezone IS NULL OR NEW.timezone = '' OR NEW.timezone = 'UTC' THEN
    SELECT COALESCE(o.timezone, 'UTC') INTO NEW.timezone
    FROM public.organizations o
    WHERE o.id = NEW.org_id;
    IF NEW.timezone IS NULL THEN
      NEW.timezone := 'UTC';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shrs_default_tz ON public.screen_health_report_schedules;
CREATE TRIGGER trg_shrs_default_tz
BEFORE INSERT ON public.screen_health_report_schedules
FOR EACH ROW EXECUTE FUNCTION public.shrs_default_timezone();