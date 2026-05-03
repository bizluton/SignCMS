-- ── LINE LIFF extensions for queue_system_tickets ────────────────────────────
ALTER TABLE public.queue_system_tickets
  ADD COLUMN line_owner_id   TEXT,
  ADD COLUMN line_member_ids TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN share_token     UUID   NOT NULL DEFAULT gen_random_uuid();

-- Fast lookup by share_token (join flow)
CREATE INDEX idx_qs_tickets_share_token
  ON public.queue_system_tickets(share_token);

-- One active (waiting) ticket per LINE UID
CREATE UNIQUE INDEX idx_qs_tickets_line_uid_waiting
  ON public.queue_system_tickets(line_owner_id)
  WHERE line_owner_id IS NOT NULL AND status = 'waiting';

-- ── RPC: queue_issue_liff_ticket ──────────────────────────────────────────────
-- Issues a ticket for a LIFF user.  If line_uid already has a waiting ticket
-- for this queue, returns it unchanged (idempotent re-entry).
CREATE OR REPLACE FUNCTION public.queue_issue_liff_ticket(
  p_queue_id uuid,
  p_line_uid text DEFAULT NULL
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_existing public.queue_system_tickets;
  v_next     integer;
  v_ticket   public.queue_system_tickets;
BEGIN
  -- Return existing waiting ticket for this UID (idempotent)
  IF p_line_uid IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id
      AND line_owner_id = p_line_uid
      AND status = 'waiting'
    LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Compute next number (current + count of waiting + 1)
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

  INSERT INTO public.queue_system_tickets (queue_id, number, status, line_owner_id)
  VALUES (p_queue_id, v_next, 'waiting', p_line_uid)
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;
