-- Remove the authenticated SELECT policies entirely.
-- For public buckets, direct file fetch via getPublicUrl() goes through the CDN
-- and does not require any SELECT policy on storage.objects. Removing these
-- policies eliminates all listing capability and resolves the linter warning.
DROP POLICY IF EXISTS "Authenticated can read media metadata" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read email assets metadata" ON storage.objects;