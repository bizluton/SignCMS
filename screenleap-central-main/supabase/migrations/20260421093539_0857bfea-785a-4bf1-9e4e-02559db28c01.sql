-- Tighten SELECT policies on public storage buckets to prevent anonymous LISTING.
-- Direct file access via getPublicUrl() still works because it bypasses RLS for public buckets.
-- Authenticated users retain SELECT (used by signed URL generation, copy operations, etc.).

DROP POLICY IF EXISTS "Media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for email assets" ON storage.objects;

-- Allow authenticated users to read object rows (needed by SDK operations that query metadata).
-- Anonymous users can no longer enumerate/list bucket contents, but can still fetch
-- individual files via the bucket's public URL (which doesn't traverse storage.objects RLS).
CREATE POLICY "Authenticated can read media metadata"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'media');

CREATE POLICY "Authenticated can read email assets metadata"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'email-assets');