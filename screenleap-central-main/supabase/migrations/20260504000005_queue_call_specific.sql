-- RPC: queue_call_specific
-- Calls a specific ticket number directly.  If a waiting ticket with that
-- number exists it is claimed (status → calling); otherwise a new calling
-- ticket is created at that exact number.  The queue's current_number is
-- advanced to at least p_number so the display reflects the call.
CREATE OR REPLACE FUNCTION public.queue_call_specific(
  p_queue_id uuid,
  p_number   integer,
  p_counter  text DEFAULT ''
)
RETURNS public.queue_system_tickets
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ticket public.queue_system_tickets;
BEGIN
  -- Claim a waiting ticket with this exact number if one exists
  UPDATE public.queue_system_tickets
  SET status       = 'calling',
      counter_name = p_counter,
      called_at    = now()
  WHERE id = (
    SELECT id FROM public.queue_system_tickets
    WHERE queue_id = p_queue_id AND number = p_number AND status = 'waiting'
    ORDER BY created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING * INTO v_ticket;

  -- No waiting ticket: create a calling ticket directly at the given number
  IF v_ticket IS NULL THEN
    INSERT INTO public.queue_system_tickets (queue_id, number, status, counter_name, called_at)
    VALUES (p_queue_id, p_number, 'calling', p_counter, now())
    RETURNING * INTO v_ticket;
  END IF;

  -- Advance queue's current_number if this call is higher
  UPDATE public.queue_system_queues
  SET current_number = GREATEST(current_number, p_number),
      updated_at     = now()
  WHERE id = p_queue_id;

  RETURN v_ticket;
END;
$$;
