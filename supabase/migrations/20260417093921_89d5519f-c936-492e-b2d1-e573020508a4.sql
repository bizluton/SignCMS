-- 1. Make org_id required on knowledge_items
ALTER TABLE public.knowledge_items ALTER COLUMN org_id SET NOT NULL;

-- 2. Create per-org sharing table
CREATE TABLE public.knowledge_item_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_item_id uuid NOT NULL REFERENCES public.knowledge_items(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  shared_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (knowledge_item_id, org_id)
);

CREATE INDEX idx_knowledge_item_shares_org ON public.knowledge_item_shares(org_id);
CREATE INDEX idx_knowledge_item_shares_item ON public.knowledge_item_shares(knowledge_item_id);

ALTER TABLE public.knowledge_item_shares ENABLE ROW LEVEL SECURITY;

-- RLS: shares table
CREATE POLICY "Admins manage all shares"
  ON public.knowledge_item_shares FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Org admins of owning org manage shares"
  ON public.knowledge_item_shares FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_item_shares.knowledge_item_id
        AND user_in_org(auth.uid(), ki.org_id)
        AND is_org_admin(auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_item_shares.knowledge_item_id
        AND user_in_org(auth.uid(), ki.org_id)
        AND is_org_admin(auth.uid())
    )
  );

CREATE POLICY "Members of recipient org can view shares"
  ON public.knowledge_item_shares FOR SELECT
  TO authenticated
  USING (user_in_org(auth.uid(), org_id));

CREATE POLICY "CS agents can view all shares"
  ON public.knowledge_item_shares FOR SELECT
  TO authenticated
  USING (is_active_cs_agent(auth.uid()));

-- 3. Replace the SELECT policy on knowledge_items: drop NULL branch, add shared-org branch
DROP POLICY IF EXISTS "Users can view knowledge items in their org or admins see all" ON public.knowledge_items;

CREATE POLICY "Users can view knowledge items in their org or shared with their org"
  ON public.knowledge_items FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR user_in_org(auth.uid(), org_id)
    OR EXISTS (
      SELECT 1 FROM public.knowledge_item_shares s
      WHERE s.knowledge_item_id = knowledge_items.id
        AND user_in_org(auth.uid(), s.org_id)
    )
  );

-- 4. Mirror the visibility on knowledge_files
DROP POLICY IF EXISTS "Users can view knowledge files in their org or admins see all" ON public.knowledge_files;

CREATE POLICY "Users can view knowledge files for accessible items"
  ON public.knowledge_files FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.knowledge_items ki
      WHERE ki.id = knowledge_files.knowledge_item_id
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