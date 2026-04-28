-- Phase 3: drop legacy text columns from media_items.
-- New numeric columns (width/height/duration_seconds/size_bytes) are now the canonical source.
ALTER TABLE public.media_items
  DROP COLUMN IF EXISTS dimensions,
  DROP COLUMN IF EXISTS duration,
  DROP COLUMN IF EXISTS size;