
CREATE TABLE public.chat_session_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_session_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view notes" ON public.chat_session_notes FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert notes" ON public.chat_session_notes FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update notes" ON public.chat_session_notes FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete notes" ON public.chat_session_notes FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));
