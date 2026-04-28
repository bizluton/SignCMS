-- Table
CREATE TABLE public.delegation_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.customer_chat_sessions(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  hours integer NOT NULL DEFAULT 24,
  reason text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  grant_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT delegation_requests_status_chk CHECK (status IN ('pending','accepted','declined','cancelled','expired')),
  CONSTRAINT delegation_requests_hours_chk CHECK (hours IN (4,24,72))
);

CREATE INDEX idx_delegation_requests_customer ON public.delegation_requests(customer_id, status);
CREATE INDEX idx_delegation_requests_session ON public.delegation_requests(session_id);

ALTER TABLE public.delegation_requests ENABLE ROW LEVEL SECURITY;

-- Customer can view requests targeted to them
CREATE POLICY "Customer can view own requests"
ON public.delegation_requests FOR SELECT TO authenticated
USING (customer_id = auth.uid());

-- Requester (CS agent) can view their own requests
CREATE POLICY "Requester can view own requests"
ON public.delegation_requests FOR SELECT TO authenticated
USING (requester_id = auth.uid());

-- Active CS agents can create requests
CREATE POLICY "CS agents can create requests"
ON public.delegation_requests FOR INSERT TO authenticated
WITH CHECK (requester_id = auth.uid() AND public.is_active_cs_agent(auth.uid()));

-- Customer can update (accept/decline) their own pending requests
CREATE POLICY "Customer can respond to own requests"
ON public.delegation_requests FOR UPDATE TO authenticated
USING (customer_id = auth.uid())
WITH CHECK (customer_id = auth.uid());

-- Requester can cancel
CREATE POLICY "Requester can cancel own requests"
ON public.delegation_requests FOR UPDATE TO authenticated
USING (requester_id = auth.uid())
WITH CHECK (requester_id = auth.uid());

-- Trigger: on insert, post system chat message + notification
CREATE OR REPLACE FUNCTION public.on_delegation_request_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _agent_name text;
BEGIN
  SELECT display_name INTO _agent_name FROM public.profiles WHERE user_id = NEW.requester_id;
  _agent_name := COALESCE(_agent_name, '客服人員');

  -- System chat message visible to the customer in their widget
  INSERT INTO public.customer_chat_messages (session_id, sender_type, sender_name, content, is_read)
  VALUES (
    NEW.session_id,
    'system',
    _agent_name,
    '[delegation_request:' || NEW.id::text || ':' || NEW.hours::text || '] ' || _agent_name || ' 請求暫時代理您的帳號 ' || NEW.hours::text || ' 小時以協助處理問題。',
    false
  );

  -- Bell notification to the customer
  INSERT INTO public.notifications (user_id, type, title, body, link, created_by)
  VALUES (
    NEW.customer_id,
    'delegation_request',
    '客服請求代理授權',
    _agent_name || ' 請求暫時代理您的帳號 ' || NEW.hours::text || ' 小時',
    '/',
    NEW.requester_id
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_on_delegation_request_created
AFTER INSERT ON public.delegation_requests
FOR EACH ROW EXECUTE FUNCTION public.on_delegation_request_created();

-- Allow realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.delegation_requests;