-- Helper function: check if user is an active CS agent
CREATE OR REPLACE FUNCTION public.is_active_cs_agent(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cs_agents
    WHERE user_id = _user_id AND status = 'active'
  )
$$;

-- 1. customer_chat_sessions: cs_agents can view and update
CREATE POLICY "CS agents can view sessions" ON public.customer_chat_sessions
  FOR SELECT TO authenticated
  USING (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can update sessions" ON public.customer_chat_sessions
  FOR UPDATE TO authenticated
  USING (is_active_cs_agent(auth.uid()));

-- 2. customer_chat_messages: cs_agents can view and insert
CREATE POLICY "CS agents can view messages" ON public.customer_chat_messages
  FOR SELECT TO authenticated
  USING (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can insert messages" ON public.customer_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (is_active_cs_agent(auth.uid()));

CREATE POLICY "CS agents can update messages" ON public.customer_chat_messages
  FOR UPDATE TO authenticated
  USING (is_active_cs_agent(auth.uid()));

-- 3. quick_reply_templates: cs_agents can manage
CREATE POLICY "CS agents can view templates" ON public.quick_reply_templates
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert templates" ON public.quick_reply_templates
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can update templates" ON public.quick_reply_templates
  FOR UPDATE TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete templates" ON public.quick_reply_templates
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 4. chat_tags: cs_agents can manage
CREATE POLICY "CS agents can view tags" ON public.chat_tags
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert tags" ON public.chat_tags
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can update tags" ON public.chat_tags
  FOR UPDATE TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete tags" ON public.chat_tags
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 5. chat_session_notes: cs_agents can manage
CREATE POLICY "CS agents can view notes" ON public.chat_session_notes
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert notes" ON public.chat_session_notes
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can update notes" ON public.chat_session_notes
  FOR UPDATE TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete notes" ON public.chat_session_notes
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 6. support_tickets: cs_agents can manage
CREATE POLICY "CS agents can view tickets" ON public.support_tickets
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert tickets" ON public.support_tickets
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can update tickets" ON public.support_tickets
  FOR UPDATE TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete tickets" ON public.support_tickets
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 7. ticket_comments: cs_agents can manage
CREATE POLICY "CS agents can view comments" ON public.ticket_comments
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert comments" ON public.ticket_comments
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can update comments" ON public.ticket_comments
  FOR UPDATE TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete comments" ON public.ticket_comments
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 8. knowledge_items: cs_agents can view
CREATE POLICY "CS agents can view knowledge items" ON public.knowledge_items
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 9. knowledge_files: cs_agents can view
CREATE POLICY "CS agents can view knowledge files" ON public.knowledge_files
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 10. customer_satisfaction_ratings: cs_agents can view
CREATE POLICY "CS agents can view ratings" ON public.customer_satisfaction_ratings
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 11. chat_session_tags: cs_agents can manage
CREATE POLICY "CS agents can view session tags" ON public.chat_session_tags
  FOR SELECT TO authenticated USING (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can insert session tags" ON public.chat_session_tags
  FOR INSERT TO authenticated WITH CHECK (is_active_cs_agent(auth.uid()));
CREATE POLICY "CS agents can delete session tags" ON public.chat_session_tags
  FOR DELETE TO authenticated USING (is_active_cs_agent(auth.uid()));

-- 12. cs_agents: active agents can view their own record (already exists)
-- 13. user_roles: cs_agents need to read admin profiles for assignment
CREATE POLICY "CS agents can view admin roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (is_active_cs_agent(auth.uid()));

-- 14. profiles: already viewable by all authenticated (no change needed)