DROP POLICY IF EXISTS "Admin or CS can insert knowledge_tags" ON public.knowledge_tags;
DROP POLICY IF EXISTS "Admin or CS can update knowledge_tags" ON public.knowledge_tags;

CREATE POLICY "Authenticated can insert knowledge_tags"
ON public.knowledge_tags
FOR INSERT
TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Authenticated can update knowledge_tags"
ON public.knowledge_tags
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);