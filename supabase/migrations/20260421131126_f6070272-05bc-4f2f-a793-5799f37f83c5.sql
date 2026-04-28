-- Explicit deny-all policies (linter prefers explicit policies even when intent is no access).
CREATE POLICY "tsk_no_select" ON public.trigger_share_keys FOR SELECT TO anon, authenticated USING (false);
CREATE POLICY "tsk_no_insert" ON public.trigger_share_keys FOR INSERT TO anon, authenticated WITH CHECK (false);
CREATE POLICY "tsk_no_update" ON public.trigger_share_keys FOR UPDATE TO anon, authenticated USING (false) WITH CHECK (false);
CREATE POLICY "tsk_no_delete" ON public.trigger_share_keys FOR DELETE TO anon, authenticated USING (false);