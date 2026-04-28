ALTER TABLE public.screens
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

COMMENT ON COLUMN public.screens.timezone
  IS 'IANA timezone of the physical screen location (e.g. Asia/Taipei). Used by publishing center to compute wall-clock-correct scheduled_at per screen, with DST handled automatically.';

-- Back-fill from org timezone for existing screens still on the UTC default
UPDATE public.screens s
SET timezone = COALESCE(o.timezone, 'UTC')
FROM public.organizations o
WHERE s.org_id = o.id
  AND (s.timezone IS NULL OR s.timezone = '' OR s.timezone = 'UTC');

-- Trigger: inherit org timezone on insert when caller didn't provide one
CREATE OR REPLACE FUNCTION public.screens_default_timezone()
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

DROP TRIGGER IF EXISTS trg_screens_default_tz ON public.screens;
CREATE TRIGGER trg_screens_default_tz
BEFORE INSERT ON public.screens
FOR EACH ROW EXECUTE FUNCTION public.screens_default_timezone();