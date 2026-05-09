-- ─────────────────────────────────────────────────────────────────────────────
-- CAS Phase 1: add sha256 column to media_items
--
-- Goals:
--   1. Server-computed SHA-256 replaces client-supplied md5 as the canonical
--      content fingerprint (md5 column kept for legacy compatibility).
--   2. Global deduplication across orgs: same bytes → same sha256 → one Storage
--      object under assets/{sha256}.{ext}.
--   3. Non-destructive: existing rows keep md5/url unchanged; sha256 is nullable
--      and only populated for new uploads going forward.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add sha256 column (nullable; legacy rows will remain NULL until backfilled)
ALTER TABLE public.media_items
  ADD COLUMN IF NOT EXISTS sha256 text;

COMMENT ON COLUMN public.media_items.sha256 IS
  'SHA-256 hex digest of the file content, computed server-side during upload. '
  'Null for legacy rows uploaded before CAS Phase 1. '
  'Format: 64 lowercase hex characters.';

-- 2. Enforce format when the value is present
ALTER TABLE public.media_items
  ADD CONSTRAINT media_items_sha256_format
  CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');

-- 3. Global dedup index: one sha256 value may appear in multiple orgs (same
--    file uploaded by different orgs still points to the same Storage object),
--    so the index is NOT UNIQUE across the whole table.
--    Instead we use a partial unique index per org:
--      • Cross-org dedup is handled at the Storage level (assets/{sha256}.{ext})
--      • Within an org, the same file should not be stored twice
CREATE UNIQUE INDEX IF NOT EXISTS media_items_org_sha256_uniq
  ON public.media_items (org_id, sha256)
  WHERE sha256 IS NOT NULL AND deleted_at IS NULL;

-- 4. Lookup index for duplicate-detection queries in upload-media Edge Function
CREATE INDEX IF NOT EXISTS media_items_sha256_idx
  ON public.media_items (sha256)
  WHERE sha256 IS NOT NULL;

-- 5. Lookup index used by player-sync to fetch sha256 + size for asset_manifest
--    (queries: WHERE id = ANY(array_of_ids) → needs sha256, size_bytes)
CREATE INDEX IF NOT EXISTS media_items_sha256_size_idx
  ON public.media_items (id, sha256, size_bytes)
  WHERE sha256 IS NOT NULL;
