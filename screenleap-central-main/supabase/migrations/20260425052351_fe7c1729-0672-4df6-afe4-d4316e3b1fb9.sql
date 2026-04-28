-- 1) RPC: check_screen_license_status
-- Returns the license status for a given screen, joining by org_id + serial_number.
-- Accessible to any authenticated user that can already SELECT the screen via existing RLS;
-- the function itself runs as SECURITY DEFINER but only exposes status metadata.
CREATE OR REPLACE FUNCTION public.check_screen_license_status(_screen_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_screen RECORD;
  v_lic RECORD;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('licensed', false, 'status', 'unauthenticated');
  END IF;

  SELECT id, org_id, serial_number
    INTO v_screen
    FROM public.screens
    WHERE id = _screen_id;

  IF v_screen.id IS NULL THEN
    RETURN jsonb_build_object('licensed', false, 'status', 'screen_not_found');
  END IF;

  -- Caller must belong to the screen's org, or be system admin / CS agent
  IF NOT (
    public.is_system_admin(v_caller)
    OR public.is_active_cs_agent(v_caller)
    OR (v_screen.org_id IS NOT NULL AND public.user_in_org(v_caller, v_screen.org_id))
  ) THEN
    RETURN jsonb_build_object('licensed', false, 'status', 'permission_denied');
  END IF;

  IF v_screen.serial_number IS NULL OR length(trim(v_screen.serial_number)) = 0 THEN
    -- No serial bound on the screen → treat as unlicensed (locked)
    RETURN jsonb_build_object('licensed', false, 'status', 'no_license');
  END IF;

  SELECT id, status, code, device_model, revoked_at
    INTO v_lic
    FROM public.device_licenses
    WHERE org_id = v_screen.org_id
      AND device_serial = v_screen.serial_number
    ORDER BY (status = 'active') DESC, updated_at DESC
    LIMIT 1;

  IF v_lic.id IS NULL THEN
    RETURN jsonb_build_object('licensed', false, 'status', 'no_license');
  END IF;

  IF v_lic.status = 'revoked' THEN
    RETURN jsonb_build_object(
      'licensed', false,
      'status', 'revoked',
      'license_id', v_lic.id,
      'license_code', v_lic.code,
      'device_model', v_lic.device_model,
      'revoked_at', v_lic.revoked_at
    );
  END IF;

  RETURN jsonb_build_object(
    'licensed', true,
    'status', 'active',
    'license_id', v_lic.id,
    'license_code', v_lic.code,
    'device_model', v_lic.device_model
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_screen_license_status(uuid) TO authenticated;

-- 2) Trigger: when a device_license is revoked, mark matching screens offline.
--    This prevents a revoked device from appearing "online / connected".
CREATE OR REPLACE FUNCTION public.on_device_license_revoked_lock_screens()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'revoked' AND COALESCE(OLD.status, '') <> 'revoked' THEN
    UPDATE public.screens
       SET online = false,
           updated_at = now()
     WHERE org_id = NEW.org_id
       AND serial_number = NEW.device_serial;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_device_license_revoked_lock_screens ON public.device_licenses;
CREATE TRIGGER trg_device_license_revoked_lock_screens
AFTER UPDATE ON public.device_licenses
FOR EACH ROW
EXECUTE FUNCTION public.on_device_license_revoked_lock_screens();

-- 3) Realtime: enable replication for device_licenses so the player + UI can react live.
ALTER TABLE public.device_licenses REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'device_licenses'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.device_licenses';
  END IF;
END$$;