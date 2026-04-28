
CREATE TABLE public.knowledge_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL,
  sub_category text NOT NULL DEFAULT '',
  file_count integer NOT NULL DEFAULT 0,
  synced boolean NOT NULL DEFAULT false,
  org_id uuid REFERENCES public.organizations(id),
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view knowledge items in their org or admins see all"
  ON public.knowledge_items FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR (org_id IS NULL) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "Admins can insert knowledge items"
  ON public.knowledge_items FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update knowledge items"
  ON public.knowledge_items FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete knowledge items"
  ON public.knowledge_items FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
