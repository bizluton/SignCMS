-- 解決 knowledge_item_shares 與 knowledge_items 之間的 RLS 無限遞迴
-- 建立 SECURITY DEFINER 函式，繞過 knowledge_items 的 RLS 來取得 org_id
CREATE OR REPLACE FUNCTION public.get_knowledge_item_org(_item_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT org_id FROM public.knowledge_items WHERE id = _item_id
$$;

-- 重建 knowledge_item_shares 的管理 policy，改用上述函式
DROP POLICY IF EXISTS "Org admins of owning org manage shares" ON public.knowledge_item_shares;

CREATE POLICY "Org admins of owning org manage shares"
ON public.knowledge_item_shares
FOR ALL
TO authenticated
USING (
  public.is_org_admin(auth.uid())
  AND public.user_in_org(auth.uid(), public.get_knowledge_item_org(knowledge_item_id))
)
WITH CHECK (
  public.is_org_admin(auth.uid())
  AND public.user_in_org(auth.uid(), public.get_knowledge_item_org(knowledge_item_id))
);

-- 同理重建 knowledge_items 的 SELECT policy，避免反向再觸發 shares 的 policy
DROP POLICY IF EXISTS "Users can view knowledge items in their org or shared with thei" ON public.knowledge_items;

CREATE OR REPLACE FUNCTION public.user_can_view_shared_item(_user_id uuid, _item_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.knowledge_item_shares s
    WHERE s.knowledge_item_id = _item_id
      AND public.user_in_org(_user_id, s.org_id)
  )
$$;

CREATE POLICY "Users can view knowledge items in their org or shared"
ON public.knowledge_items
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.user_in_org(auth.uid(), org_id)
  OR public.user_can_view_shared_item(auth.uid(), id)
);