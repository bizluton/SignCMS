-- Marks certain device_models rows as system built-ins that cannot be deleted.
--
-- Background
-- ----------
-- "Web Player" (browsers / Samsung Tizen URL Launcher) is a virtual device type
-- that exists in every SignCMS install.  It must always be selectable in the
-- device-licence dropdown and must never disappear — hence the is_system guard.
--
-- Changes
-- -------
-- 1. device_models.is_system (bool, default false)
--    Rows with is_system = true are protected at two layers:
--      a. RLS DELETE policy updated: even system admins cannot delete them.
--      b. BEFORE DELETE trigger raises an exception as a belt-and-suspenders guard.
--
-- 2. output_ports type set extended: "Browser" added alongside HDMI/DP/Type-C/Other.
--    The type is stored in JSONB; no DB-level check constraint enforces the set —
--    constraint lives in the UI (PORT_TYPES array in DeviceLicenseManagement.tsx).
--    This comment documents the full valid set.
--    output_ports.type ∈ { "HDMI", "DP", "Type-C", "Browser", "Other" }
--
-- 3. Seed: "Web Player" model
--    • Inserted if missing, or updated in-place if already present.
--    • brand_id  → Generic brand (created by migration 20260521000011)
--    • output_ports  → [{ id:"out1", label:"Browser", type:"Browser" }]
--    • supported_output_modes → ["mirror"]
--    • is_system → true

-- ── 1. Add is_system column ────────────────────────────────────────────────────
ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.device_models.is_system IS
  'true = system built-in model (e.g. Web Player). Cannot be deleted via RLS or trigger.';

-- ── 2. Replace DELETE RLS policy — block deletion of system rows ──────────────
DROP POLICY IF EXISTS "System admin can delete device models" ON public.device_models;

CREATE POLICY "System admin can delete device models"
  ON public.device_models FOR DELETE TO authenticated
  USING (public.is_system_admin(auth.uid()) AND NOT is_system);

-- ── 3. Trigger: belt-and-suspenders guard against DELETE on system rows ────────
CREATE OR REPLACE FUNCTION public.guard_system_device_model_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION 'Cannot delete system built-in device model "%"', OLD.name;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_system_device_model ON public.device_models;
CREATE TRIGGER trg_guard_system_device_model
  BEFORE DELETE ON public.device_models
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_system_device_model_delete();

-- ── 4. Seed / update "Web Player" ─────────────────────────────────────────────
-- Use INSERT … ON CONFLICT so this is safe to re-run.
INSERT INTO public.device_models
       (name, sort_order, brand_id, output_ports, supported_output_modes, is_system)
VALUES (
  'Web Player',
  0,
  (SELECT id FROM public.device_brands WHERE name = 'Generic' LIMIT 1),
  '[{"id":"out1","label":"Browser","type":"Browser"}]'::jsonb,
  '["mirror"]'::jsonb,
  true
)
ON CONFLICT (name) DO UPDATE
  SET brand_id               = (SELECT id FROM public.device_brands WHERE name = 'Generic' LIMIT 1),
      output_ports           = '[{"id":"out1","label":"Browser","type":"Browser"}]'::jsonb,
      supported_output_modes = '["mirror"]'::jsonb,
      is_system              = true,
      updated_at             = now();
