
-- Tags table
CREATE TABLE public.chat_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view tags" ON public.chat_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert tags" ON public.chat_tags FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update tags" ON public.chat_tags FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete tags" ON public.chat_tags FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Junction table
CREATE TABLE public.chat_session_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.chat_tags(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, tag_id)
);

ALTER TABLE public.chat_session_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view session tags" ON public.chat_session_tags FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert session tags" ON public.chat_session_tags FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete session tags" ON public.chat_session_tags FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
