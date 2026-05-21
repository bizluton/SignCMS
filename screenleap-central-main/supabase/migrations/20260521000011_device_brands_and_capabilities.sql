-- Phase 1 of the "project ↔ device output capability matching" feature.
--
-- Extends device_models to capture WHAT a device can physically do — brand,
-- output ports, supported output modes — so that later phases (B / C) can
-- match a ContentStudio project's output requirements (outputMode +
-- outputCount) against the screens that can actually drive that layout.
--
-- This migration is purely additive:
--   • device_brands         (new)  one row per manufacturer
--   • device_models.brand_id (new) FK → device_brands; SET NULL on brand delete
--   • device_models.output_ports             (new JSONB, default [])
--   • device_models.supported_output_modes   (new JSONB, default ["mirror"])
--
-- Backfill: existing rows get brand_id by name prefix and a "minimum
-- capability" port + mode set (1× HDMI, mirror only). Operators are
-- expected to edit each model in the UI to set its real capability.
--
-- output_ports JSONB shape:
--   [
--     { "id": "out1", "label": "Output 1", "type": "HDMI" },
--     { "id": "out2", "label": "Output 2", "type": "DP" }
--   ]
--   type ∈ { "HDMI", "DP", "Type-C", "Other" }
--   When type = "Other", an additional "customLabel" field MAY be present.
--
-- supported_output_modes JSONB shape:
--   ["mirror", "independent", "extend", "matrix"]   (subset of these)

-- ── 1. device_brands ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_brands (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  sort_order  int         NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.device_brands ENABLE ROW LEVEL SECURITY;

-- System admins manage; everyone authenticated can SELECT (needed so non-admin
-- callers can render brand names in read-only contexts, e.g. screen lists).
CREATE POLICY "device_brands_admin_write"
  ON public.device_brands FOR ALL TO authenticated
  USING       (public.is_system_admin(auth.uid()))
  WITH CHECK  (public.is_system_admin(auth.uid()));

CREATE POLICY "device_brands_select_all"
  ON public.device_brands FOR SELECT TO authenticated
  USING (true);

-- Seed initial brands matching the existing 4 device models on prod.
INSERT INTO public.device_brands (name, sort_order)
VALUES
  ('Bizlution', 10),
  ('Qbic',      20),
  ('Samsung',   30),
  ('Generic',   100)
ON CONFLICT (name) DO NOTHING;

-- ── 2. device_models — extend ──────────────────────────────────────────────
ALTER TABLE public.device_models
  ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES public.device_brands(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS output_ports           jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS supported_output_modes jsonb NOT NULL DEFAULT '["mirror"]'::jsonb;

-- ── 3. Backfill brand_id by name prefix on existing rows ───────────────────
-- Best-effort match; anything that doesn't start with a known brand falls
-- through to "Generic".
UPDATE public.device_models
   SET brand_id = (SELECT id FROM public.device_brands WHERE name = 'Bizlution')
 WHERE brand_id IS NULL AND name ILIKE 'Bizlution%';

UPDATE public.device_models
   SET brand_id = (SELECT id FROM public.device_brands WHERE name = 'Qbic')
 WHERE brand_id IS NULL AND name ILIKE 'Qbic%';

UPDATE public.device_models
   SET brand_id = (SELECT id FROM public.device_brands WHERE name = 'Samsung')
 WHERE brand_id IS NULL AND name ILIKE 'Samsung%';

UPDATE public.device_models
   SET brand_id = (SELECT id FROM public.device_brands WHERE name = 'Generic')
 WHERE brand_id IS NULL;

-- ── 4. Backfill output_ports + supported_output_modes to minimum-capability ─
-- 1× HDMI port + mirror-only. Operators upgrade per-model in the UI.
-- Skip rows that already have non-default values (idempotent on replay).
UPDATE public.device_models
   SET output_ports = '[{"id": "out1", "label": "Output 1", "type": "HDMI"}]'::jsonb
 WHERE jsonb_array_length(output_ports) = 0;

UPDATE public.device_models
   SET supported_output_modes = '["mirror"]'::jsonb
 WHERE jsonb_array_length(supported_output_modes) = 0;

-- ── 5. Index brand_id for the model-list join ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_device_models_brand_id
  ON public.device_models(brand_id);

COMMENT ON COLUMN public.device_models.brand_id IS
  'FK to device_brands. Nullable — orphaned models default to brand "Generic" via backfill.';
COMMENT ON COLUMN public.device_models.output_ports IS
  'Array of {id, label, type[, customLabel]} objects. type ∈ HDMI|DP|Type-C|Other. Default 1× HDMI on insert.';
COMMENT ON COLUMN public.device_models.supported_output_modes IS
  'Array of strings from {mirror, independent, extend, matrix}. Default ["mirror"].';
