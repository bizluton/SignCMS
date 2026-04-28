
-- Add attachment columns to customer_chat_messages
ALTER TABLE public.customer_chat_messages
  ADD COLUMN attachment_url text,
  ADD COLUMN attachment_type text;

-- Create storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-attachments', 'chat-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload chat attachments
CREATE POLICY "Authenticated users can upload chat attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'chat-attachments');

-- Allow public read access to chat attachments
CREATE POLICY "Public can view chat attachments"
ON storage.objects FOR SELECT
USING (bucket_id = 'chat-attachments');
