-- Fix: allow re-uploading files that were previously soft-deleted.
--
-- The old unique constraint (org_id, md5, size_bytes) had no WHERE clause,
-- so it blocked INSERT for any file whose soft-deleted record still existed.
-- Replace it with a partial unique index that only applies to live (non-deleted) rows.

ALTER TABLE media_items DROP CONSTRAINT IF EXISTS media_items_org_md5_size_uniq;

CREATE UNIQUE INDEX IF NOT EXISTS media_items_org_md5_size_uniq
  ON media_items (org_id, md5, size_bytes)
  WHERE deleted_at IS NULL;
