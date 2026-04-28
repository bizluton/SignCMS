-- 1) Categories table (system-wide)
CREATE TABLE public.knowledge_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'Folder',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view categories"
  ON public.knowledge_categories FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin or CS can insert categories"
  ON public.knowledge_categories FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin or CS can update categories"
  ON public.knowledge_categories FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin or CS can delete categories"
  ON public.knowledge_categories FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE TRIGGER update_knowledge_categories_updated_at
BEFORE UPDATE ON public.knowledge_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Tags table (system-wide, distinct from chat_tags)
CREATE TABLE public.knowledge_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  color text NOT NULL DEFAULT '#3B82F6',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.knowledge_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view knowledge_tags"
  ON public.knowledge_tags FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin or CS can insert knowledge_tags"
  ON public.knowledge_tags FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin or CS can update knowledge_tags"
  ON public.knowledge_tags FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE POLICY "Admin or CS can delete knowledge_tags"
  ON public.knowledge_tags FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR is_active_cs_agent(auth.uid()));

CREATE TRIGGER update_knowledge_tags_updated_at
BEFORE UPDATE ON public.knowledge_tags
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Knowledge item <-> tag join
CREATE TABLE public.knowledge_item_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.knowledge_tags(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_item_id, tag_id)
);

CREATE INDEX idx_knowledge_item_tags_item ON public.knowledge_item_tags(knowledge_item_id);
CREATE INDEX idx_knowledge_item_tags_tag ON public.knowledge_item_tags(tag_id);

ALTER TABLE public.knowledge_item_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View item tags for accessible items"
  ON public.knowledge_item_tags FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_active_cs_agent(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_item_tags.knowledge_item_id
        AND (
          user_in_org(auth.uid(), ki.org_id)
          OR EXISTS (
            SELECT 1 FROM public.knowledge_item_shares s
            WHERE s.knowledge_item_id = ki.id
              AND user_in_org(auth.uid(), s.org_id)
          )
        )
    )
  );

CREATE POLICY "Manage item tags for owned items"
  ON public.knowledge_item_tags FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_active_cs_agent(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_item_tags.knowledge_item_id
        AND user_in_org(auth.uid(), ki.org_id)
        AND is_org_admin(auth.uid())
    )
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR is_active_cs_agent(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_item_tags.knowledge_item_id
        AND user_in_org(auth.uid(), ki.org_id)
        AND is_org_admin(auth.uid())
    )
  );

-- 4) Add category_id to knowledge_items (nullable for now, keep legacy "category" text for compatibility)
ALTER TABLE public.knowledge_items
  ADD COLUMN category_id uuid REFERENCES public.knowledge_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_knowledge_items_category_id ON public.knowledge_items(category_id);

-- 5) Seed default categories
INSERT INTO public.knowledge_categories (name, description, icon, sort_order, created_by)
VALUES
  ('產品介紹', '產品功能、規格、簡介', 'Package', 10, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
  ('技術支援', '故障排除、技術說明', 'Wrench', 20, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
  ('常見問題', 'FAQ 與常見回覆', 'HelpCircle', 30, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
  ('政策條款', '隱私、退款、服務條款', 'FileText', 40, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
  ('操作指南', '步驟教學、使用手冊', 'BookOpen', 50, '3fbb2f97-7268-4cac-a511-7cff6654a8f7'),
  ('其他', '未分類項目', 'Folder', 100, '3fbb2f97-7268-4cac-a511-7cff6654a8f7');