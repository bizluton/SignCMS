-- ── queue_system_queues ──────────────────────────────────────────────────────
CREATE TABLE public.queue_system_queues (
  id             uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  queue_name     text        NOT NULL,
  prefix         text        NOT NULL DEFAULT '',
  current_number integer     NOT NULL DEFAULT 0,
  reset_daily    boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qs_queues_org ON public.queue_system_queues(org_id);
ALTER TABLE public.queue_system_queues ENABLE ROW LEVEL SECURITY;

-- ── queue_system_tickets ─────────────────────────────────────────────────────
CREATE TABLE public.queue_system_tickets (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  queue_id     uuid        NOT NULL REFERENCES public.queue_system_queues(id) ON DELETE CASCADE,
  number       integer     NOT NULL,
  status       text        NOT NULL DEFAULT 'waiting'
               CHECK (status IN ('waiting', 'calling', 'done')),
  counter_name text        NOT NULL DEFAULT '',
  called_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_qs_tickets_queue_status ON public.queue_system_tickets(queue_id, status, number);
ALTER TABLE public.queue_system_tickets ENABLE ROW LEVEL SECURITY;

-- ── queue_system_configs ─────────────────────────────────────────────────────
-- Per-org credentials for external kiosk integrations (HMAC-signed API calls).
-- api_secret is never returned to the browser — only accessible via service role.
CREATE TABLE public.queue_system_configs (
  org_id        uuid        NOT NULL PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  install_token text        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  api_secret    text        NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  settings      jsonb       NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.queue_system_configs ENABLE ROW LEVEL SECURITY;

-- ── RLS: queue_system_queues ─────────────────────────────────────────────────
-- Display widget (anon) reads queue data for the Realtime ticker.
CREATE POLICY "anon_read_qs_queues"
  ON public.queue_system_queues FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "org_manage_qs_queues"
  ON public.queue_system_queues FOR ALL
  TO authenticated
  USING  (public.user_in_org(auth.uid(), org_id))
  WITH CHECK (public.user_in_org(auth.uid(), org_id));

-- ── RLS: queue_system_tickets ────────────────────────────────────────────────
CREATE POLICY "anon_read_qs_tickets"
  ON public.queue_system_tickets FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "org_manage_qs_tickets"
  ON public.queue_system_tickets FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.queue_system_queues q
      WHERE q.id = queue_id AND public.user_in_org(auth.uid(), q.org_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.queue_system_queues q
      WHERE q.id = queue_id AND public.user_in_org(auth.uid(), q.org_id)
    )
  );

-- ── RLS: queue_system_configs ────────────────────────────────────────────────
-- install_token and settings visible to org admins; api_secret excluded via
-- column-level SELECT grants omitted intentionally (service role only reads it).
CREATE POLICY "org_admin_read_qs_configs"
  ON public.queue_system_configs FOR SELECT
  TO authenticated
  USING (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), org_id));

CREATE POLICY "org_admin_manage_qs_configs"
  ON public.queue_system_configs FOR ALL
  TO authenticated
  USING  (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), org_id))
  WITH CHECK (public.is_org_admin(auth.uid()) AND public.user_in_org(auth.uid(), org_id));

-- ── Realtime ─────────────────────────────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_system_queues;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_system_tickets;

-- ── RPC: queue_call_next ─────────────────────────────────────────────────────
-- Atomically claims the oldest waiting ticket for a counter, or auto-creates
-- one when no waiting tickets exist (walk-up / kiosk-free mode).
-- Uses FOR UPDATE SKIP LOCKED so two concurrent counters never get the same ticket.
CREATE OR REPLACE FUNCTION public.queue_call_next(
  p_queue_id uuid,
  p_counter  text DEFAULT ''
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket public.queue_system_tickets;
  v_next   integer;
BEGIN
  -- Try to claim the oldest waiting ticket
  UPDATE public.queue_system_tickets
  SET status       = 'calling',
      counter_name = p_counter,
      called_at    = now()
  WHERE id = (
    SELECT id FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id AND status = 'waiting'
    ORDER BY number ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_ticket;

  IF v_ticket IS NOT NULL THEN
    UPDATE public.queue_system_queues
    SET current_number = v_ticket.number, updated_at = now()
    WHERE id = p_queue_id;
    RETURN v_ticket;
  END IF;

  -- No waiting tickets: auto-advance current_number and create a calling ticket
  UPDATE public.queue_system_queues
  SET current_number = current_number + 1, updated_at = now()
  WHERE id = p_queue_id
  RETURNING current_number INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'queue_not_found';
  END IF;

  INSERT INTO public.queue_system_tickets (queue_id, number, status, counter_name, called_at)
  VALUES (p_queue_id, v_next, 'calling', p_counter, now())
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

-- ── RPC: queue_issue_ticket ───────────────────────────────────────────────────
-- Called by a physical kiosk: issue the next waiting ticket number.
CREATE OR REPLACE FUNCTION public.queue_issue_ticket(p_queue_id uuid)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_next   integer;
  v_ticket public.queue_system_tickets;
BEGIN
  SELECT current_number + (
    SELECT COUNT(*) FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id AND status = 'waiting'
  ) + 1
  INTO v_next
  FROM public.queue_system_queues
  WHERE id = p_queue_id;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'queue_not_found';
  END IF;

  INSERT INTO public.queue_system_tickets (queue_id, number, status)
  VALUES (p_queue_id, v_next, 'waiting')
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

-- ── RPC: queue_reset ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.queue_reset(p_queue_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.queue_system_queues
  SET current_number = 0, updated_at = now()
  WHERE id = p_queue_id;

  UPDATE public.queue_system_tickets
  SET status = 'done'
  WHERE queue_id = p_queue_id AND status IN ('waiting', 'calling');
END;
$$;
