-- Add original filename, md5 hash, and mime type to media_items
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS original_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS md5 text,
  ADD COLUMN IF NOT EXISTS mime_type text NOT NULL DEFAULT '';

-- Backfill original_name from existing name for legacy rows
UPDATE public.media_items
SET original_name = name
WHERE original_name = '' OR original_name IS NULL;

-- Unique index: prevent duplicate (md5 + size_bytes) within the same org.
-- Only applies when md5 is not null, so legacy rows without md5 are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS media_items_org_md5_size_uniq
  ON public.media_items (org_id, md5, size_bytes)
  WHERE md5 IS NOT NULL;

-- Helpful lookup index for duplicate detection queries
CREATE INDEX IF NOT EXISTS media_items_org_md5_idx
  ON public.media_items (org_id, md5)
  WHERE md5 IS NOT NULL;