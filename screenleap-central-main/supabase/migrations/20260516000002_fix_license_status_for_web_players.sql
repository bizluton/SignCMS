-- Screens created via screen_activation_codes (web player flow) have no
-- device_licenses entry, so they were incorrectly shown as "未授權".
-- Fix: treat any screen whose id appears in screen_activation_codes
-- (status='used') as licensed=true / status='active', unless a
-- device_license explicitly revokes it.

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
    s.id                                                               AS screen_id,
    CASE
      WHEN best.status = 'revoked'                                    THEN false
      WHEN best.status = 'active'                                     THEN true
      WHEN ac.screen_id IS NOT NULL                                   THEN true
      ELSE false
    END                                                                AS licensed,
    CASE
      WHEN best.status = 'revoked'                                    THEN 'revoked'
      WHEN best.status = 'active'                                     THEN 'active'
      WHEN ac.screen_id IS NOT NULL                                   THEN 'active'
      ELSE 'no_license'
    END                                                                AS status
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
  ) best ON true
  LEFT JOIN (
    SELECT DISTINCT screen_id
    FROM   public.screen_activation_codes
    WHERE  status    = 'used'
      AND  screen_id IS NOT NULL
  ) ac ON ac.screen_id = s.id;
$$;

GRANT EXECUTE ON FUNCTION public.check_screen_license_status_batch(uuid[]) TO authenticated;
