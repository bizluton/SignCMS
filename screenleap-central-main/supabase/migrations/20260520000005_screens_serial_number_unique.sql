-- screens.serial_number was originally added with NOT NULL DEFAULT ''.
-- That makes "no serial set" indistinguishable from "set to empty" and
-- allowed multiple screens to share the same serial — verify-device-license
-- could not trust serial as a stable device identifier.
--
-- This migration:
--   1. Drops the DEFAULT '' so new inserts must provide a real value
--      (the codebase already does).
--   2. Attempts to add a partial UNIQUE index over non-empty serials.
--      If duplicates already exist in production, the index creation is
--      skipped with a NOTICE so the deploy still succeeds; an operator
--      must clean up the duplicates and re-run the index creation by hand.

-- 1. Drop the default.
ALTER TABLE public.screens
  ALTER COLUMN serial_number DROP DEFAULT;

-- 2. Try to add the unique index, but tolerate pre-existing duplicates.
DO $$
DECLARE
  v_dup_count int;
BEGIN
  -- Count non-empty serials that have duplicates.
  SELECT count(*) INTO v_dup_count
    FROM (
      SELECT serial_number
        FROM public.screens
       WHERE serial_number IS NOT NULL AND trim(serial_number) <> ''
       GROUP BY serial_number
      HAVING count(*) > 1
    ) d;

  IF v_dup_count > 0 THEN
    RAISE NOTICE
      'screens_serial_number_unique_nonempty NOT created — % duplicate serial value(s) found. Clean up duplicates (UPDATE … SET serial_number=...) then run the CREATE UNIQUE INDEX manually.',
      v_dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS screens_serial_number_unique_nonempty
      ON public.screens (serial_number)
      WHERE serial_number IS NOT NULL AND trim(serial_number) <> '';
  END IF;
END
$$;

COMMENT ON COLUMN public.screens.serial_number IS
  'Hardware serial / virtual serial. Empty string allowed for legacy rows. Non-empty values are unique (partial index screens_serial_number_unique_nonempty).';
