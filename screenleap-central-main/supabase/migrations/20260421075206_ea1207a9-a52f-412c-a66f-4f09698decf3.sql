-- Per-org media tags + many-to-many junction with media_items
CREATE TABLE IF NOT EXISTS public.media_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

ALTER TABLE public.media_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view media_tags"
  ON public.media_tags FOR SELECT TO authenticated
  USING (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "Org members can insert media_tags"
  ON public.media_tags FOR INSERT TO authenticated
  WITH CHECK (is_system_admin(auth.uid()) OR user_in_org(auth.uid(), org_id));

CREATE POLICY "Org admins can update media_tags"
  ON public.media_tags FOR UPDATE TO authenticated
  USING (is_system_admin(auth.uid()) OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid())))
  WITH CHECK (is_system_admin(auth.uid()) OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid())));

CREATE POLICY "Org admins can delete media_tags"
  ON public.media_tags FOR DELETE TO authenticated
  USING (is_system_admin(auth.uid()) OR (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid())));

CREATE TRIGGER trg_media_tags_updated_at
  BEFORE UPDATE ON public.media_tags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Junction
CREATE TABLE IF NOT EXISTS public.media_item_tags (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  media_id UUID NOT NULL REFERENCES public.media_items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.media_tags(id) ON DELETE CASCADE,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (media_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_media_item_tags_media ON public.media_item_tags(media_id);
CREATE INDEX IF NOT EXISTS idx_media_item_tags_tag ON public.media_item_tags(tag_id);

ALTER TABLE public.media_item_tags ENABLE ROW LEVEL SECURITY;

-- View if user can view the underlying media (same org).
CREATE POLICY "View media_item_tags by media org"
  ON public.media_item_tags FOR SELECT TO authenticated
  USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.media_items mi
      WHERE mi.id = media_item_tags.media_id
        AND user_in_org(auth.uid(), mi.org_id)
    )
  );

CREATE POLICY "Insert media_item_tags by media org"
  ON public.media_item_tags FOR INSERT TO authenticated
  WITH CHECK (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.media_items mi
      WHERE mi.id = media_item_tags.media_id
        AND user_in_org(auth.uid(), mi.org_id)
    )
  );

CREATE POLICY "Delete media_item_tags by media org"
  ON public.media_item_tags FOR DELETE TO authenticated
  USING (
    is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.media_items mi
      WHERE mi.id = media_item_tags.media_id
        AND user_in_org(auth.uid(), mi.org_id)
    )
  );