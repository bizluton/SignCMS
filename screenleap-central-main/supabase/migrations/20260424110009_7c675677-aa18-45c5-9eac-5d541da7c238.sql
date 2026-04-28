-- Server-side, timezone-aware expansion of channel schedule blocks.
-- Returns one row per (block, day) interval inside [_from, _to), filtering out
-- past days relative to "today" in the supplied IANA timezone.
CREATE OR REPLACE FUNCTION public.get_channel_schedule_intervals(
  _channel_id uuid,
  _tz text,
  _from timestamptz,
  _to timestamptz
)
RETURNS TABLE(
  block_id uuid,
  design_project_id uuid,
  name text,
  color text,
  block_type text,
  priority integer,
  day date,
  start_min integer,
  end_min integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org_id uuid;
  v_tz text := COALESCE(NULLIF(trim(_tz), ''), 'UTC');
  v_today date;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  IF _channel_id IS NULL OR _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  -- Resolve & authorize: caller must belong to the channel's org (or be sys admin).
  SELECT c.org_id INTO v_org_id FROM public.channels c WHERE c.id = _channel_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'channel_not_found';
  END IF;
  IF NOT (public.is_system_admin(v_caller) OR public.user_in_org(v_caller, v_org_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- "Today" as observed in the supplied IANA timezone.
  BEGIN
    v_today := (now() AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN others THEN
    v_today := (now() AT TIME ZONE 'UTC')::date;
  END;

  RETURN QUERY
  WITH win AS (
    SELECT _from::date AS f_date, (_to - interval '1 microsecond')::date AS t_date
  ),
  -- Calendar blocks: walk each overlapped UTC day in [start_at, end_at).
  cal AS (
    SELECT
      b.id AS block_id,
      b.design_project_id,
      b.name,
      b.color,
      b.block_type,
      b.priority,
      d::date AS day,
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (GREATEST(b.start_at, d) - d)) / 60
      )::int AS start_min,
      LEAST(
        24 * 60,
        EXTRACT(EPOCH FROM (LEAST(b.end_at, d + interval '1 day') - d)) / 60
      )::int AS end_min
    FROM public.channel_blocks b
    CROSS JOIN LATERAL generate_series(
      GREATEST(date_trunc('day', b.start_at), date_trunc('day', _from)),
      LEAST(b.end_at - interval '1 microsecond', _to - interval '1 microsecond'),
      interval '1 day'
    ) AS d
    WHERE b.channel_id = _channel_id
      AND b.enabled = true
      AND b.block_type = 'calendar'
      AND b.start_at IS NOT NULL
      AND b.end_at IS NOT NULL
      AND b.start_at < _to
      AND b.end_at > _from
  ),
  -- Weekly blocks: expand each day in the window, keep matching weekdays,
  -- respect effective_from / effective_to (default effective_from = today-in-tz).
  weekly AS (
    SELECT
      b.id AS block_id,
      b.design_project_id,
      b.name,
      b.color,
      b.block_type,
      b.priority,
      d::date AS day,
      ((SUBSTRING(b.start_time FROM 1 FOR 2))::int * 60
        + (SUBSTRING(b.start_time FROM 4 FOR 2))::int) AS start_min,
      ((SUBSTRING(b.end_time FROM 1 FOR 2))::int * 60
        + (SUBSTRING(b.end_time FROM 4 FOR 2))::int) AS end_min
    FROM public.channel_blocks b
    CROSS JOIN LATERAL generate_series(_from::date, (_to - interval '1 microsecond')::date, interval '1 day') AS d
    WHERE b.channel_id = _channel_id
      AND b.enabled = true
      AND b.block_type = 'weekly'
      AND b.start_time IS NOT NULL
      AND b.end_time IS NOT NULL
      AND b.weekdays IS NOT NULL
      AND array_length(b.weekdays, 1) > 0
      AND (CASE EXTRACT(DOW FROM d)::int
             WHEN 0 THEN 'sun' WHEN 1 THEN 'mon' WHEN 2 THEN 'tue'
             WHEN 3 THEN 'wed' WHEN 4 THEN 'thu' WHEN 5 THEN 'fri'
             WHEN 6 THEN 'sat'
           END) = ANY(b.weekdays)
      -- TZ-aware "not in the past" filter:
      AND d::date >= GREATEST(
            COALESCE(b.effective_from::date, v_today),
            v_today
          )
      AND (b.effective_to IS NULL OR d::date <= b.effective_to::date)
  )
  SELECT * FROM cal
  WHERE end_min > start_min
  UNION ALL
  SELECT * FROM weekly
  WHERE end_min > start_min
  ORDER BY day, priority DESC, start_min;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_channel_schedule_intervals(uuid, text, timestamptz, timestamptz) TO authenticated;