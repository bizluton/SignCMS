-- Create public media bucket for SignCMS Go file uploads
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'media',
  'media',
  true,
  104857600,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
        'video/mp4','video/webm','video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- Service role has full access (used by edge functions)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'media_service_role_all'
  ) THEN
    CREATE POLICY "media_service_role_all" ON storage.objects
      FOR ALL TO service_role USING (bucket_id = 'media');
  END IF;
END $$;

-- Public read (URLs are shared on screens)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'media_public_read'
  ) THEN
    CREATE POLICY "media_public_read" ON storage.objects
      FOR SELECT TO public USING (bucket_id = 'media');
  END IF;
END $$;
