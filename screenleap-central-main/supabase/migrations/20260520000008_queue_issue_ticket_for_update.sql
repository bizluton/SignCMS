-- Fix the queue_issue_ticket / queue_issue_liff_ticket race condition.
--
-- Original code (20260504000001 / 20260504000002):
--   SELECT current_number + COUNT(waiting tickets) + 1 INTO v_next
--   INSERT INTO queue_system_tickets ... VALUES (..., v_next, ...)
--
-- The read of current_number + waiting count and the subsequent INSERT
-- are NOT atomic. Two concurrent kiosk presses could both compute the
-- same v_next, producing identical ticket numbers (or violating a future
-- unique constraint).
--
-- Fix:
--   1. SELECT … FOR UPDATE on the queue_system_queues row to serialize
--      number generation per queue.
--   2. Also lock the COUNT of waiting tickets to the same snapshot —
--      since FOR UPDATE blocks the queue row, any concurrent issue must
--      wait until our INSERT commits and the count moves up.
--   3. Add SET search_path = public, pg_temp (also addresses the missing
--      search_path noted in the audit).

CREATE OR REPLACE FUNCTION public.queue_issue_ticket(p_queue_id uuid)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current integer;
  v_waiting integer;
  v_next    integer;
  v_ticket  public.queue_system_tickets;
BEGIN
  -- Serialise number generation on the queue row.
  SELECT current_number INTO v_current
    FROM public.queue_system_queues
   WHERE id = p_queue_id
     FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'queue_not_found';
  END IF;

  SELECT count(*) INTO v_waiting
    FROM public.queue_system_tickets
   WHERE queue_id = p_queue_id AND status = 'waiting';

  v_next := v_current + v_waiting + 1;

  INSERT INTO public.queue_system_tickets (queue_id, number, status)
  VALUES (p_queue_id, v_next, 'waiting')
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_issue_ticket(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.queue_issue_ticket(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.queue_issue_liff_ticket(
  p_queue_id uuid,
  p_line_uid text DEFAULT NULL
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.queue_system_tickets;
  v_current  integer;
  v_waiting  integer;
  v_next     integer;
  v_ticket   public.queue_system_tickets;
BEGIN
  -- Idempotent re-entry: existing waiting ticket for the same LINE UID
  -- returns unchanged. The unique partial index on (line_owner_id) WHERE
  -- status='waiting' would also reject a second insert, but checking
  -- first is friendlier.
  IF p_line_uid IS NOT NULL THEN
    SELECT * INTO v_existing
      FROM public.queue_system_tickets
     WHERE queue_id      = p_queue_id
       AND line_owner_id = p_line_uid
       AND status        = 'waiting'
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Same serialised number generation as queue_issue_ticket.
  SELECT current_number INTO v_current
    FROM public.queue_system_queues
   WHERE id = p_queue_id
     FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'queue_not_found';
  END IF;

  SELECT count(*) INTO v_waiting
    FROM public.queue_system_tickets
   WHERE queue_id = p_queue_id AND status = 'waiting';

  v_next := v_current + v_waiting + 1;

  INSERT INTO public.queue_system_tickets (queue_id, number, status, line_owner_id)
  VALUES (p_queue_id, v_next, 'waiting', p_line_uid)
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.queue_issue_liff_ticket(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.queue_issue_liff_ticket(uuid, text) TO authenticated;
