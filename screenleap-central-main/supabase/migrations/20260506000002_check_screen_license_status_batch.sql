-- Batch version of check_screen_license_status.
-- Replaces the N+1 per-screen RPC pattern in ScreensPage with a single call.
-- Joins via device_serial + org_id (same logic as the single-screen version).
--
-- Returns one row per requested screen_id with:
--   licensed  boolean  – true if there is an active licence
--   status    text     – 'active' | 'revoked' | 'no_license'

CREATE OR REPLACE FUNCTION public.check_screen_license_status_batch(
  _screen_ids uuid[]
)
RETURNS TABLE (
  screen_id uuid,
  licensed  boolean,
  status    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id                                                            AS screen_id,
    COALESCE(best.status = 'active', false)                         AS licensed,
    COALESCE(best.status,
      CASE WHEN s.serial_number IS NULL OR trim(s.serial_number) = ''
           THEN 'no_license' ELSE 'no_license' END)                 AS status
  FROM unnest(_screen_ids) AS req(id)
  JOIN public.screens s ON s.id = req.id
  LEFT JOIN LATERAL (
    SELECT dl.status
    FROM   public.device_licenses dl
    WHERE  dl.org_id        = s.org_id
      AND  dl.device_serial = s.serial_number
      AND  s.serial_number IS NOT NULL
      AND  trim(s.serial_number) <> ''
    ORDER  BY (dl.status = 'active') DESC, dl.updated_at DESC
    LIMIT  1
  ) best ON true;
$$;

GRANT EXECUTE ON FUNCTION public.check_screen_license_status_batch(uuid[]) TO authenticated;
