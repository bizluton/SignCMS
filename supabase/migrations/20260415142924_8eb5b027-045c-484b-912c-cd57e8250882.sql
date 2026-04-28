-- Fix 1: Restrict notifications INSERT to service_role only
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON public.notifications;
CREATE POLICY "Service role can insert notifications"
  ON public.notifications
  FOR INSERT
  TO public
  WITH CHECK (auth.role() = 'service_role');

-- Fix 2: Make chat-attachments bucket private
UPDATE storage.buckets SET public = false WHERE id = 'chat-attachments';

-- Fix 3: Replace open SELECT policy with authenticated-only
DROP POLICY IF EXISTS "Public can view chat attachments" ON storage.objects;
CREATE POLICY "Authenticated can view chat attachments"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'chat-attachments');
