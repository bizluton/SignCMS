
-- Fix channels RLS: allow system_admin to insert/update/delete
DROP POLICY IF EXISTS channels_insert_org_admin ON public.channels;
CREATE POLICY channels_insert_org_admin ON public.channels FOR INSERT TO authenticated
WITH CHECK (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS channels_update_org_admin ON public.channels;
CREATE POLICY channels_update_org_admin ON public.channels FOR UPDATE TO authenticated
USING (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS channels_delete_org_admin ON public.channels;
CREATE POLICY channels_delete_org_admin ON public.channels FOR DELETE TO authenticated
USING (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

-- Fix channel_blocks RLS: allow system_admin to insert/update/delete
DROP POLICY IF EXISTS channel_blocks_insert_org_admin ON public.channel_blocks;
CREATE POLICY channel_blocks_insert_org_admin ON public.channel_blocks FOR INSERT TO authenticated
WITH CHECK (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS channel_blocks_update_org_admin ON public.channel_blocks;
CREATE POLICY channel_blocks_update_org_admin ON public.channel_blocks FOR UPDATE TO authenticated
USING (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS channel_blocks_delete_org_admin ON public.channel_blocks;
CREATE POLICY channel_blocks_delete_org_admin ON public.channel_blocks FOR DELETE TO authenticated
USING (
  (user_in_org(auth.uid(), org_id) AND (is_org_admin(auth.uid()) OR has_role(auth.uid(), 'admin'::app_role)))
  OR is_system_admin(auth.uid())
);

-- Also fix screen_channel_subscriptions and screen_channel_switch_triggers
DROP POLICY IF EXISTS scs_insert_org_admin ON public.screen_channel_subscriptions;
CREATE POLICY scs_insert_org_admin ON public.screen_channel_subscriptions FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM screens s JOIN team_members tm ON tm.user_id = auth.uid() JOIN teams t ON t.id = tm.team_id AND t.org_id = s.org_id WHERE s.id = screen_id)
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS scs_delete_org_admin ON public.screen_channel_subscriptions;
CREATE POLICY scs_delete_org_admin ON public.screen_channel_subscriptions FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM screens s JOIN team_members tm ON tm.user_id = auth.uid() JOIN teams t ON t.id = tm.team_id AND t.org_id = s.org_id WHERE s.id = screen_id)
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS scst_insert_org_admin ON public.screen_channel_switch_triggers;
CREATE POLICY scst_insert_org_admin ON public.screen_channel_switch_triggers FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM screens s JOIN team_members tm ON tm.user_id = auth.uid() JOIN teams t ON t.id = tm.team_id AND t.org_id = s.org_id WHERE s.id = screen_id)
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS scst_update_org_admin ON public.screen_channel_switch_triggers;
CREATE POLICY scst_update_org_admin ON public.screen_channel_switch_triggers FOR UPDATE TO authenticated
USING (
  EXISTS (SELECT 1 FROM screens s JOIN team_members tm ON tm.user_id = auth.uid() JOIN teams t ON t.id = tm.team_id AND t.org_id = s.org_id WHERE s.id = screen_id)
  OR is_system_admin(auth.uid())
);

DROP POLICY IF EXISTS scst_delete_org_admin ON public.screen_channel_switch_triggers;
CREATE POLICY scst_delete_org_admin ON public.screen_channel_switch_triggers FOR DELETE TO authenticated
USING (
  EXISTS (SELECT 1 FROM screens s JOIN team_members tm ON tm.user_id = auth.uid() JOIN teams t ON t.id = tm.team_id AND t.org_id = s.org_id WHERE s.id = screen_id)
  OR is_system_admin(auth.uid())
);
