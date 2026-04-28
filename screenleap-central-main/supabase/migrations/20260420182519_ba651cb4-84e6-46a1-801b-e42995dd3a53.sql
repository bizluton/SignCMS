
CREATE OR REPLACE FUNCTION public.validate_channel_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.block_type = 'calendar' THEN
    IF NEW.start_at IS NULL OR NEW.end_at IS NULL THEN
      RAISE EXCEPTION 'calendar block requires start_at and end_at';
    END IF;
    IF NEW.end_at <= NEW.start_at THEN
      RAISE EXCEPTION 'calendar block end_at must be after start_at';
    END IF;
  ELSIF NEW.block_type = 'weekly' THEN
    IF NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
      RAISE EXCEPTION 'weekly block requires start_time and end_time';
    END IF;
    IF array_length(NEW.weekdays, 1) IS NULL THEN
      RAISE EXCEPTION 'weekly block requires at least one weekday';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
