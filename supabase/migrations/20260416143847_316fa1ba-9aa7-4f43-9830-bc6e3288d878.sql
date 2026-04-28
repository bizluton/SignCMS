
-- 1. Fix notifications: restrict INSERT so user_id must equal auth.uid()
DROP POLICY IF EXISTS "Users can insert notifications with own identity" ON public.notifications;
CREATE POLICY "Users can insert notifications to self only"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND user_id = auth.uid());

-- 2. Fix chat-attachments storage policies
-- Drop overly permissive policies
DROP POLICY IF EXISTS "Authenticated can view chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload chat attachments" ON storage.objects;

-- SELECT: admin, CS agent, or session owner
CREATE POLICY "Chat attachment view by authorized users"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_active_cs_agent(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.customer_chat_sessions s
        WHERE s.id::text = (storage.foldername(name))[1]
          AND s.user_id = auth.uid()
      )
    )
  );

-- INSERT: admin, CS agent, or session owner
CREATE POLICY "Chat attachment upload by authorized users"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (
      has_role(auth.uid(), 'admin'::app_role)
      OR is_active_cs_agent(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.customer_chat_sessions s
        WHERE s.id::text = (storage.foldername(name))[1]
          AND s.user_id = auth.uid()
      )
    )
  );

-- 3. Make knowledge-files bucket private
UPDATE storage.buckets SET public = false WHERE id = 'knowledge-files';
