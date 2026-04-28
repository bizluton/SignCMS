-- Create public 'media' bucket for ad assets (videos / images)
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Anyone can read media (public playback)
CREATE POLICY "Media is publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'media');

-- Authenticated users can upload
CREATE POLICY "Authenticated users can upload media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'media' AND auth.uid() = owner);

-- Owners can update their own files
CREATE POLICY "Owners can update their media"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'media' AND auth.uid() = owner);

-- Owners can delete their own files
CREATE POLICY "Owners can delete their media"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'media' AND auth.uid() = owner);

-- System admin can manage all media files
CREATE POLICY "System admin manages all media"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'media' AND auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid)
WITH CHECK (bucket_id = 'media' AND auth.uid() = '3fbb2f97-7268-4cac-a511-7cff6654a8f7'::uuid);