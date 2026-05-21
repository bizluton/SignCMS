-- Phase 2 of "project ↔ device output capability matching".
--
-- Denormalises ContentStudio's outputMode + outputCount from the zones[0]._meta
-- JSON blob into two indexed columns on design_projects, so Phase 3 (schedule /
-- publishing) can JOIN against device_models.supported_output_modes without
-- having to JSONB-parse every project at query time.
--
-- Mapping: ContentStudio uses 5 granular modes; device capability uses 4
-- coarse categories. We store the CATEGORY here so Phase 3 lookups are direct.
-- Studio still keeps the granular value inside zones meta for itself.
--
--   mirror       → mirror
--   independent  → independent
--   extend-h     ─┐
--   extend-v     ─┴→ extend
--   grid-2x2-h   → matrix
--
-- Trigger keeps the columns in sync on INSERT/UPDATE so writers that forget
-- to set them (legacy clients, RPCs) still get something sensible. The app
-- layer (ContentStudio handleSave) writes them explicitly going forward.

-- ── 1. Add columns ─────────────────────────────────────────────────────────
ALTER TABLE public.design_projects
  ADD COLUMN IF NOT EXISTS output_mode  text CHECK (output_mode IN ('mirror', 'independent', 'extend', 'matrix')),
  ADD COLUMN IF NOT EXISTS output_count int  CHECK (output_count >= 1 AND output_count <= 4);

-- ── 2. Helper: categorise a studio mode value ──────────────────────────────
CREATE OR REPLACE FUNCTION public.categorize_studio_output_mode(studio_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE studio_mode
    WHEN 'mirror'       THEN 'mirror'
    WHEN 'independent'  THEN 'independent'
    WHEN 'extend-h'     THEN 'extend'
    WHEN 'extend-v'     THEN 'extend'
    WHEN 'grid-2x2-h'   THEN 'matrix'
    ELSE 'mirror'  -- safe default for unknown / null
  END;
$$;

-- ── 3. Backfill from zones[0]._meta ────────────────────────────────────────
UPDATE public.design_projects
   SET output_mode = public.categorize_studio_output_mode(
        COALESCE(zones->0->>'outputMode', 'mirror')
      ),
       output_count = GREATEST(1, LEAST(4, COALESCE((zones->0->>'outputCount')::int, 1)))
 WHERE output_mode IS NULL
   AND zones IS NOT NULL
   AND jsonb_typeof(zones) = 'array'
   AND jsonb_array_length(zones) > 0;

-- Catch any remaining nulls (projects with no zones / unparseable meta)
UPDATE public.design_projects
   SET output_mode = 'mirror',
       output_count = 1
 WHERE output_mode IS NULL;

-- ── 4. Sync trigger ────────────────────────────────────────────────────────
-- Whenever a writer changes zones, re-derive output_mode / output_count from
-- the new meta entry. App can also set them explicitly — explicit wins, trigger
-- only fires when the columns are NULL or zones changed AND the columns weren't
-- explicitly set in this statement.

CREATE OR REPLACE FUNCTION public.sync_design_project_output_info()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta_mode  text;
  v_meta_count int;
BEGIN
  -- Only auto-derive when caller didn't supply the columns or supplied NULL.
  -- This lets ContentStudio's explicit values win without the trigger
  -- overwriting them on every save.
  IF NEW.output_mode IS NOT NULL AND NEW.output_count IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.zones IS NULL OR jsonb_typeof(NEW.zones) <> 'array' OR jsonb_array_length(NEW.zones) = 0 THEN
    NEW.output_mode  := COALESCE(NEW.output_mode,  'mirror');
    NEW.output_count := COALESCE(NEW.output_count, 1);
    RETURN NEW;
  END IF;

  v_meta_mode  := NEW.zones->0->>'outputMode';
  v_meta_count := COALESCE((NEW.zones->0->>'outputCount')::int, 1);

  IF NEW.output_mode IS NULL THEN
    NEW.output_mode := public.categorize_studio_output_mode(COALESCE(v_meta_mode, 'mirror'));
  END IF;
  IF NEW.output_count IS NULL THEN
    NEW.output_count := GREATEST(1, LEAST(4, v_meta_count));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_design_project_output_info ON public.design_projects;
CREATE TRIGGER trg_sync_design_project_output_info
  BEFORE INSERT OR UPDATE OF zones, output_mode, output_count ON public.design_projects
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_design_project_output_info();

-- ── 5. Indexes for Phase 3 filter queries ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_design_projects_output_mode
  ON public.design_projects(output_mode);

COMMENT ON COLUMN public.design_projects.output_mode IS
  'Coarse output mode category {mirror, independent, extend, matrix}. Denormalised from zones[0]._meta.outputMode (5 granular studio values map to these 4 categories). Used by Phase 3 to JOIN device_models.supported_output_modes for compatibility filtering.';
COMMENT ON COLUMN public.design_projects.output_count IS
  'Number of physical outputs the project drives (1-4). Denormalised from zones[0]._meta.outputCount.';
