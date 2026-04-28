
-- Create storage bucket for knowledge files
INSERT INTO storage.buckets (id, name, public)
VALUES ('knowledge-files', 'knowledge-files', true);

-- RLS for storage: authenticated users can read
CREATE POLICY "Authenticated users can view knowledge files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'knowledge-files');

-- Admins can upload
CREATE POLICY "Admins can upload knowledge files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'knowledge-files' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Admins can delete
CREATE POLICY "Admins can delete knowledge files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'knowledge-files' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- Create knowledge_files table
CREATE TABLE public.knowledge_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_size text NOT NULL DEFAULT '',
  file_type text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view knowledge files in their org or admins see all"
  ON public.knowledge_files FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_files.knowledge_item_id
      AND ((ki.org_id IS NULL) OR public.user_in_org(auth.uid(), ki.org_id))
    )
  );

CREATE POLICY "Admins can insert knowledge files"
  ON public.knowledge_files FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete knowledge files"
  ON public.knowledge_files FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Create function to update file_count on knowledge_items
CREATE OR REPLACE FUNCTION public.update_knowledge_item_file_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.knowledge_items SET file_count = (
      SELECT count(*) FROM public.knowledge_files WHERE knowledge_item_id = NEW.knowledge_item_id
    ) WHERE id = NEW.knowledge_item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.knowledge_items SET file_count = (
      SELECT count(*) FROM public.knowledge_files WHERE knowledge_item_id = OLD.knowledge_item_id
    ) WHERE id = OLD.knowledge_item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_update_knowledge_file_count
  AFTER INSERT OR DELETE ON public.knowledge_files
  FOR EACH ROW EXECUTE FUNCTION public.update_knowledge_item_file_count();
