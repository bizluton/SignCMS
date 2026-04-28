
-- Chat sessions table
CREATE TABLE public.customer_chat_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  org_id UUID REFERENCES public.organizations(id),
  telegram_chat_id BIGINT,
  status TEXT NOT NULL DEFAULT 'open',
  subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

ALTER TABLE public.customer_chat_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sessions"
  ON public.customer_chat_sessions FOR SELECT
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create own sessions"
  ON public.customer_chat_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can update sessions"
  ON public.customer_chat_sessions FOR UPDATE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_chat_sessions_user ON public.customer_chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_telegram ON public.customer_chat_sessions(telegram_chat_id);

-- Chat messages table
CREATE TABLE public.customer_chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL DEFAULT 'customer',
  sender_name TEXT,
  content TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view messages of own sessions"
  ON public.customer_chat_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.customer_chat_sessions s
      WHERE s.id = session_id AND (s.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Users can insert messages to own sessions"
  ON public.customer_chat_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.customer_chat_sessions s
      WHERE s.id = session_id AND (s.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
    )
  );

CREATE POLICY "Admins can update messages"
  ON public.customer_chat_messages FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_chat_messages_session ON public.customer_chat_messages(session_id);

-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_chat_sessions;

-- Telegram bot state for polling
CREATE TABLE public.telegram_bot_state (
  id INT PRIMARY KEY CHECK (id = 1),
  update_offset BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

INSERT INTO public.telegram_bot_state (id, update_offset) VALUES (1, 0);

-- Trigger for updated_at on sessions
CREATE TRIGGER update_chat_sessions_updated_at
  BEFORE UPDATE ON public.customer_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
